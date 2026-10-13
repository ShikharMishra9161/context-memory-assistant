// Turns a validated /generate request into a handoff. The pipeline itself
// (chunking, merging, retries, deterministic fallback) lives in the shared core.
const { loadCore } = require('../lib/core');
const { HttpError } = require('../lib/http');

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

  return core.generateWithLlm(extraction, { mode, projectName, customInstructions }, llm, {
    ...llmConfig,
    unavailableReason: llmUnavailableReason,
    logger,
  });
}

module.exports = { generateHandoff };
