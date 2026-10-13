// Shared, dependency-free handoff logic used by the extension popup and the backend.
export * from './normalize.js';
export * from './schema.js';
export * from './analyze.js';
export * from './deterministic.js';
export * from './markdown.js';
export * from './chunk.js';
export * from './prompts.js';

import { normalizeMessages, assessCompleteness } from './normalize.js';
import { buildDeterministicHandoff } from './deterministic.js';
import { renderHandoffMarkdown } from './markdown.js';

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
