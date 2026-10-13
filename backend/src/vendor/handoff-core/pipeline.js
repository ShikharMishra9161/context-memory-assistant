// End-to-end generation: deterministic (offline) and LLM (chunk -> per-chunk
// JSON -> lossless merge -> optional consolidation). Used by the extension
// (with the user's own API key) and by the backend.
import { normalizeMessages, assessCompleteness } from './normalize.js';
import { buildDeterministicHandoff, attachArtifacts } from './deterministic.js';
import { renderHandoffMarkdown } from './markdown.js';
import { chunkMessages, mergeHandoffs, parseJsonLoose } from './chunk.js';
import { coerceHandoff } from './schema.js';
import { analyzeConversation } from './analyze.js';
import { buildSystemPrompt, buildChunkPrompt, buildConsolidatePrompt } from './prompts.js';

/**
 * Builds the meta block attached to every handoff.
 * @param {object} extraction { platform, conversationId, url, title, extractedAt, complete, warnings, messageCount }
 */
export function buildMeta(extraction, { mode, generator }) {
  return {
    platform: extraction.platform || '',
    conversationId: extraction.conversationId || '',
    sourceUrl: extraction.url || '',
    conversationTitle: extraction.title || '',
    extractedAt: extraction.extractedAt || '',
    generatedAt: new Date().toISOString(),
    mode,
    generator,
    extraction: {
      messageCount: extraction.messageCount ?? 0,
      complete: Boolean(extraction.complete),
      warnings: extraction.warnings || [],
    },
  };
}

/** Normalize + assess in one step, for raw content-script output. */
export function prepareExtraction(raw) {
  const normalized = normalizeMessages(raw.messages || []);
  const { complete, warnings } = assessCompleteness(normalized, raw.signals || {});
  return {
    platform: raw.platform,
    conversationId: raw.conversationId,
    url: raw.url,
    title: raw.title,
    extractedAt: raw.extractedAt || new Date().toISOString(),
    messages: normalized.messages,
    stats: normalized.stats,
    messageCount: normalized.stats.count,
    complete,
    warnings,
  };
}

/** Full offline pipeline: deterministic handoff + Markdown. */
export function generateDeterministic(extraction, { mode = 'continue', projectName = '', customInstructions = '', fallbackReason = '' } = {}) {
  const handoff = buildDeterministicHandoff(extraction.messages, {
    projectName,
    conversationTitle: extraction.title,
    customInstructions: mode === 'custom' ? customInstructions : '',
  });
  handoff.meta = buildMeta(extraction, { mode, generator: { type: 'deterministic', fallbackReason } });
  return { handoff, markdown: renderHandoffMarkdown(handoff, { mode, messages: extraction.messages }) };
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Retries transient provider errors (rate limits, overload, timeouts) with exponential backoff. */
export async function withRetry(fn, { retries = 2, baseDelayMs = 1500 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const transient = err.code === 'RATE_LIMIT' || err.code === 'TIMEOUT' || err.code === 'NETWORK' || (err.status >= 500 && err.status < 600);
      if (!transient || attempt >= retries) throw err;
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
}

/** LLM refs are 1-based message numbers; the schema stores 0-based indexes. */
export function shiftRefs(handoff, messageCount) {
  const fix = items => items.forEach(it => {
    it.refs = it.refs.map(r => r - 1).filter(r => r >= 0 && r < messageCount);
  });
  for (const section of ['project', 'state', 'decisions', 'currentTask', 'nextSteps']) {
    for (const v of Object.values(handoff[section])) if (Array.isArray(v)) fix(v);
  }
  fix(handoff.unknowns);
  return handoff;
}

export const DEFAULT_LLM_LIMITS = { maxInputChars: 120000, maxOutputTokens: 8192, maxChunks: 12, concurrency: 2, retries: 2 };

const countItems = h => ['state', 'decisions', 'nextSteps']
  .reduce((n, s) => n + Object.values(h[s]).filter(Array.isArray).reduce((m, a) => m + a.length, 0), 0);

/**
 * Generates a handoff with an LLM, falling back to the deterministic generator
 * on any failure so the extracted conversation is never lost.
 * @param {object} extraction prepared extraction (normalized messages)
 * @param {{mode?:string, projectName?:string, customInstructions?:string}} options
 * @param {{name:string, model:string, generate:Function}|null} llm
 * @param {object} limits see DEFAULT_LLM_LIMITS; plus optional unavailableReason and logger
 * @returns {Promise<{handoff, markdown, generator}>}
 */
export async function generateWithLlm(extraction, { mode = 'continue', projectName = '', customInstructions = '' } = {}, llm, limits = {}) {
  const cfg = { ...DEFAULT_LLM_LIMITS, ...limits };
  const logger = cfg.logger || console;
  const fallback = reason => {
    const out = generateDeterministic(extraction, { mode, projectName, customInstructions, fallbackReason: reason });
    return { ...out, generator: out.handoff.meta.generator };
  };

  if (!llm) return fallback(cfg.unavailableReason || 'AI generation is not configured');

  const chunks = chunkMessages(extraction.messages, cfg.maxInputChars);
  if (chunks.length > cfg.maxChunks) {
    return fallback(`the conversation needs ${chunks.length} chunks, above the configured limit of ${cfg.maxChunks} (LLM_MAX_CHUNKS)`);
  }

  const system = buildSystemPrompt();
  const started = Date.now();
  let parts;
  try {
    parts = await mapLimit(chunks, cfg.concurrency, async (chunk, i) => {
      const text = await withRetry(() => llm.generate({
        system,
        prompt: buildChunkPrompt(chunk, { index: i + 1, total: chunks.length, mode, projectName, customInstructions: mode === 'custom' ? customInstructions : '' }),
        maxTokens: cfg.maxOutputTokens,
      }), { retries: cfg.retries, baseDelayMs: cfg.retryDelayMs ?? 1500 });
      return shiftRefs(coerceHandoff(parseJsonLoose(text)), extraction.messageCount);
    });
  } catch (err) {
    logger.warn(`[generate] LLM failed (${err.code || 'ERROR'}): ${String(err.message).slice(0, 300)}`);
    return fallback(`the AI provider failed (${err.code || 'error'}): ${String(err.message).slice(0, 200).replace(/[.\s]+$/, '')}`);
  }

  let handoff = mergeHandoffs(parts);
  let consolidated = false;
  if (chunks.length > 1 && JSON.stringify(handoff).length < cfg.maxInputChars) {
    try {
      const text = await llm.generate({ system, prompt: buildConsolidatePrompt(handoff, { mode }), maxTokens: cfg.maxOutputTokens });
      const result = coerceHandoff(parseJsonLoose(text));
      // Guard against a consolidation that silently drops content.
      if (countItems(result) >= Math.floor(countItems(handoff) * 0.6)) { handoff = result; consolidated = true; }
      else logger.warn('[generate] consolidation dropped too many items; keeping mechanical merge');
    } catch (err) {
      logger.warn(`[generate] consolidation failed (${err.code || 'ERROR'}); keeping mechanical merge`);
    }
  }

  // Verbatim artifacts (code, commands, errors, paths) always come from the deterministic extractor.
  attachArtifacts(handoff, analyzeConversation(extraction.messages));
  if (projectName) handoff.project.name = projectName;
  handoff.customNotes = mode === 'custom' ? customInstructions : '';

  const generator = { type: 'llm', provider: llm.name, model: llm.model, chunks: chunks.length, consolidated, ms: Date.now() - started };
  handoff.meta = buildMeta(extraction, { mode, generator });
  return { handoff, markdown: renderHandoffMarkdown(handoff, { mode, messages: extraction.messages }), generator };
}
