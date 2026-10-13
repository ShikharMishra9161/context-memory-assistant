// Backend adapter for the shared LLM providers (vendor/handoff-core/llm.js).
// createLlmProvider stays synchronous for app setup; the ES-module core is
// loaded lazily on the first generate() call.
const { loadCore } = require('../../lib/core');

const KNOWN = {
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-4.1-mini',
  anthropic: 'claude-sonnet-5-5',
};

/**
 * Creates the configured provider, or returns { provider: null, reason } when
 * none is usable so callers can fall back to deterministic generation.
 */
function createLlmProvider(llmConfig, { fetchImpl } = {}) {
  const { provider, apiKey } = llmConfig;
  if (!provider || provider === 'none') {
    return { provider: null, reason: 'No LLM provider configured. Set LLM_PROVIDER and the matching API key in backend/.env' };
  }
  if (!KNOWN[provider]) return { provider: null, reason: `Unknown LLM_PROVIDER "${provider}". Use gemini, openai or anthropic` };
  if (!apiKey) return { provider: null, reason: `LLM_PROVIDER is "${provider}" but no API key is set` };

  const model = llmConfig.model || KNOWN[provider];
  let impl;
  return {
    provider: {
      name: provider,
      model,
      async generate(args) {
        if (!impl) {
          const core = await loadCore();
          impl = core.createLlmProvider({ provider, apiKey, model, baseUrl: llmConfig.baseUrl, timeoutMs: llmConfig.timeoutMs, fetchImpl }).provider;
        }
        return impl.generate(args);
      },
    },
    reason: '',
  };
}

module.exports = { createLlmProvider, DEFAULT_MODELS: KNOWN };
