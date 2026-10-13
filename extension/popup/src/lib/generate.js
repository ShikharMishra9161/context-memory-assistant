import { generateDeterministic, generateWithLlm, createLlmProvider, LLM_PROVIDERS } from '../../../../shared/handoff-core/index.js';
import { apiFetch } from '../../../lib/settings.js';

// Budget for calls made directly from the browser with the user's own key.
const BYOK_LIMITS = { maxInputChars: 100000, maxOutputTokens: 8192, maxChunks: 12, concurrency: 2, retries: 2 };

function deterministic(extraction, options, fallbackReason, notice) {
  const out = generateDeterministic(extraction, { ...options, fallbackReason });
  return { ...out, generator: out.handoff.meta.generator, ...(notice ? { notice } : {}) };
}

async function viaBackend(extraction, options) {
  try {
    return await apiFetch('/generate', {
      method: 'POST',
      timeoutMs: 240000,
      body: {
        ...options,
        customInstructions: options.mode === 'custom' ? options.customInstructions : '',
        extraction: {
          platform: extraction.platform,
          title: extraction.title,
          url: extraction.url,
          conversationId: extraction.conversationId,
          extractedAt: extraction.extractedAt,
          complete: extraction.complete,
          warnings: extraction.warnings,
          messages: extraction.messages.map(m => ({ role: m.role, text: m.text, nativeId: m.nativeId })),
        },
      },
    });
  } catch (err) {
    return deterministic(extraction, options, `backend unavailable: ${err.message}`,
      `AI generation failed (${err.message}). A basic handoff was generated locally instead.`);
  }
}

async function viaOwnKey(extraction, options, byok) {
  const { provider, reason } = createLlmProvider({ ...byok, browser: true, timeoutMs: 120000 });
  if (!provider) {
    return deterministic(extraction, options, reason, `${reason}. Add your API key in Settings. A basic handoff was generated instead.`);
  }
  const result = await generateWithLlm(extraction, options, provider, { ...BYOK_LIMITS, logger: console });
  if (result.generator.type !== 'llm') {
    const label = LLM_PROVIDERS[byok.provider]?.label || byok.provider;
    return { ...result, notice: `${label} could not generate the handoff (${result.generator.fallbackReason}). A basic handoff was generated instead.` };
  }
  return result;
}

/**
 * Generates a handoff according to settings.aiMode. Every failure falls back
 * to the local deterministic generator, so the extraction is never lost.
 * @returns {Promise<{handoff, markdown, generator, notice?: string}>}
 */
export async function generateHandoff({ extraction, mode, projectName, customInstructions, settings }) {
  const options = { mode, projectName, customInstructions };
  if (settings.aiMode === 'backend') return viaBackend(extraction, options);
  if (settings.aiMode === 'byok') return viaOwnKey(extraction, options, settings.byok);
  return deterministic(extraction, options, 'AI generation is turned off in Settings');
}
