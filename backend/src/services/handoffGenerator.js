// Turns an extracted conversation into a structured handoff.
// LLM path: chunk -> per-chunk JSON -> mechanical merge -> optional consolidation.
// Any LLM failure falls back to the deterministic generator so no data is lost.
const { loadCore } = require('../lib/core');
const { HttpError } = require('../lib/http');

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Transient provider errors (rate limits, overload) are retried with backoff.
async function withRetry(fn, { retries = 2, baseDelayMs = 1500 } = {}) {
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

// LLM refs are 1-based message numbers; the schema stores 0-based indexes.
function shiftRefs(handoff, messageCount) {
  const fix = items => items.forEach(it => {
    it.refs = it.refs.map(r => r - 1).filter(r => r >= 0 && r < messageCount);
  });
  for (const section of ['project', 'state', 'decisions', 'currentTask', 'nextSteps']) {
    for (const v of Object.values(handoff[section])) if (Array.isArray(v)) fix(v);
  }
  fix(handoff.unknowns);
  return handoff;
}

/**
 * @param {object} input validated request: { mode, projectName, customInstructions, extraction }
 * @param {{ llm: object|null, llmUnavailableReason: string, llmConfig: object, logger?: Console }} deps
 */
async function generateHandoff(input, { llm, llmUnavailableReason, llmConfig, logger = console }) {
  const core = await loadCore();
  const { mode, projectName, customInstructions } = input;

  // Re-normalize server-side; never trust client indexes or dedupe.
  const normalized = core.normalizeMessages(input.extraction.messages);
  const assessed = core.assessCompleteness(normalized, {});
  const extraction = {
    ...input.extraction,
    messages: normalized.messages,
    messageCount: normalized.stats.count,
    complete: input.extraction.complete && assessed.complete,
    warnings: [...new Set([...(input.extraction.warnings || []), ...assessed.warnings])],
  };
  if (!extraction.messageCount) {
    throw new HttpError(400, 'The extracted conversation contains no usable messages.', 'EMPTY_CONVERSATION');
  }

  const fallback = reason => {
    const out = core.generateDeterministic(extraction, { mode, projectName, customInstructions, fallbackReason: reason });
    return { ...out, generator: out.handoff.meta.generator };
  };

  if (!llm) return fallback(llmUnavailableReason || 'AI generation is not configured.');

  const chunks = core.chunkMessages(extraction.messages, llmConfig.maxInputChars);
  if (chunks.length > llmConfig.maxChunks) {
    return fallback(`the conversation needs ${chunks.length} chunks, above the configured limit of ${llmConfig.maxChunks} (LLM_MAX_CHUNKS)`);
  }

  const system = core.buildSystemPrompt();
  const started = Date.now();
  let parts;
  try {
    parts = await mapLimit(chunks, llmConfig.concurrency, async (chunk, i) => {
      const text = await withRetry(() => llm.generate({
        system,
        prompt: core.buildChunkPrompt(chunk, { index: i + 1, total: chunks.length, mode, projectName, customInstructions: mode === 'custom' ? customInstructions : '' }),
        maxTokens: llmConfig.maxOutputTokens,
      }), { retries: llmConfig.retries ?? 2 });
      return shiftRefs(core.coerceHandoff(core.parseJsonLoose(text)), extraction.messageCount);
    });
  } catch (err) {
    logger.warn(`[generate] LLM failed (${err.code || 'ERROR'}): ${String(err.message).slice(0, 300)}`);
    return fallback(`the AI provider failed (${err.code || 'error'}): ${String(err.message).slice(0, 200).replace(/[.\s]+$/, '')}`);
  }

  let handoff = core.mergeHandoffs(parts);
  let consolidated = false;
  if (chunks.length > 1) {
    const mergedJson = JSON.stringify(handoff);
    if (mergedJson.length < llmConfig.maxInputChars) {
      try {
        const text = await llm.generate({ system, prompt: core.buildConsolidatePrompt(handoff, { mode }), maxTokens: llmConfig.maxOutputTokens });
        const result = core.coerceHandoff(core.parseJsonLoose(text));
        // Guard against a consolidation that silently drops content.
        const count = h => ['state', 'decisions', 'nextSteps'].reduce((n, s) => n + Object.values(h[s]).filter(Array.isArray).reduce((m, a) => m + a.length, 0), 0);
        if (count(result) >= Math.floor(count(handoff) * 0.6)) { handoff = result; consolidated = true; }
        else logger.warn('[generate] consolidation dropped too many items; keeping mechanical merge');
      } catch (err) {
        logger.warn(`[generate] consolidation failed (${err.code || 'ERROR'}); keeping mechanical merge`);
      }
    }
  }

  // Verbatim artifacts (code, commands, errors, paths) always come from the deterministic extractor.
  core.attachArtifacts(handoff, core.analyzeConversation(extraction.messages));
  if (projectName) handoff.project.name = projectName;
  handoff.customNotes = mode === 'custom' ? customInstructions : '';

  const generator = { type: 'llm', provider: llm.name, model: llm.model, chunks: chunks.length, consolidated, ms: Date.now() - started };
  handoff.meta = core.buildMeta(extraction, { mode, generator });
  const markdown = core.renderHandoffMarkdown(handoff, { mode, messages: extraction.messages });
  return { handoff, markdown, generator };
}

module.exports = { generateHandoff, shiftRefs };
