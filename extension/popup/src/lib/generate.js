import { generateDeterministic } from '../../../../shared/handoff-core/index.js';
import { apiFetch } from '../../../lib/settings.js';

/**
 * Generates a handoff. Uses the backend LLM only when the user enabled it;
 * any failure falls back to the local deterministic generator so the
 * extracted conversation is never lost.
 * @returns {Promise<{handoff, markdown, generator, notice?: string}>}
 */
export async function generateHandoff({ extraction, mode, projectName, customInstructions, settings }) {
  const options = { mode, projectName, customInstructions };

  if (!settings.useBackendAI) {
    const out = generateDeterministic(extraction, { ...options, fallbackReason: 'AI generation is turned off in Settings' });
    return { ...out, generator: out.handoff.meta.generator };
  }

  try {
    const result = await apiFetch('/generate', {
      method: 'POST',
      timeoutMs: 240000,
      body: {
        mode,
        projectName,
        customInstructions: mode === 'custom' ? customInstructions : '',
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
    return result;
  } catch (err) {
    const out = generateDeterministic(extraction, { ...options, fallbackReason: `backend unavailable: ${err.message}` });
    return { ...out, generator: out.handoff.meta.generator, notice: `AI generation failed (${err.message}). A basic handoff was generated locally instead.` };
  }
}
