// LLM provider abstraction shared by the backend and the extension.
// Each provider exposes generate({ system, prompt, maxTokens }) -> Promise<string>
// and throws LlmError with a stable `code`. Plain fetch, no SDKs.

export class LlmError extends Error {
  constructor(message, code = 'UPSTREAM', status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const LLM_PROVIDERS = {
  gemini: { label: 'Google Gemini', defaultModel: 'gemini-2.5-flash', origin: 'https://generativelanguage.googleapis.com', keyUrl: 'https://aistudio.google.com/apikey' },
  openai: { label: 'OpenAI', defaultModel: 'gpt-4.1-mini', origin: 'https://api.openai.com', keyUrl: 'https://platform.openai.com/api-keys' },
  anthropic: { label: 'Anthropic Claude', defaultModel: 'claude-sonnet-5-5', origin: 'https://api.anthropic.com', keyUrl: 'https://console.anthropic.com/settings/keys' },
};

async function postJson(url, { headers, body, timeoutMs, fetchImpl }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await (fetchImpl || globalThis.fetch)(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new LlmError(`LLM request timed out after ${Math.round(timeoutMs / 1000)}s`, 'TIMEOUT');
    throw new LlmError(`Could not reach the LLM provider: ${err.message}`, 'NETWORK');
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const detail = (data?.error?.message || data?.error || text || '').toString().slice(0, 300);
    let code = 'UPSTREAM';
    if (res.status === 401 || res.status === 403) code = 'AUTH';
    else if (res.status === 429) code = 'RATE_LIMIT';
    else if (res.status === 413 || /context|too long|token/i.test(detail)) code = 'CONTEXT_TOO_LONG';
    throw new LlmError(`LLM provider returned HTTP ${res.status}: ${detail}`, code, res.status);
  }
  if (!data) throw new LlmError('LLM provider returned a non-JSON response', 'UPSTREAM', res.status);
  return data;
}

function gemini({ apiKey, model, timeoutMs, baseUrl, fetchImpl }) {
  const base = baseUrl || `${LLM_PROVIDERS.gemini.origin}/v1beta`;
  return async ({ system, prompt, maxTokens }) => {
    const data = await postJson(`${base}/models/${encodeURIComponent(model)}:generateContent`, {
      headers: { 'x-goog-api-key': apiKey },
      body: {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: maxTokens, temperature: 0.2 },
      },
      timeoutMs,
      fetchImpl,
    });
    const cand = data.candidates?.[0];
    const text = (cand?.content?.parts || []).map(p => p.text || '').join('');
    if (!text) throw new LlmError(`Gemini returned no text (finishReason: ${cand?.finishReason || data.promptFeedback?.blockReason || 'unknown'})`, 'EMPTY');
    if (cand?.finishReason === 'MAX_TOKENS') throw new LlmError('Gemini output was cut off at the token limit', 'TRUNCATED');
    return text;
  };
}

function openai({ apiKey, model, timeoutMs, baseUrl, fetchImpl }) {
  const base = baseUrl || `${LLM_PROVIDERS.openai.origin}/v1`;
  return async ({ system, prompt, maxTokens }) => {
    const data = await postJson(`${base}/chat/completions`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      body: {
        model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        max_completion_tokens: maxTokens,
      },
      timeoutMs,
      fetchImpl,
    });
    const choice = data.choices?.[0];
    const text = choice?.message?.content;
    if (!text) throw new LlmError('OpenAI returned no text', 'EMPTY');
    if (choice.finish_reason === 'length') throw new LlmError('OpenAI output was cut off at the token limit', 'TRUNCATED');
    return text;
  };
}

function anthropic({ apiKey, model, timeoutMs, baseUrl, fetchImpl, browser }) {
  const base = baseUrl || `${LLM_PROVIDERS.anthropic.origin}/v1`;
  return async ({ system, prompt, maxTokens }) => {
    const data = await postJson(`${base}/messages`, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        // Required by Anthropic for calls made from a browser with the user's own key.
        ...(browser ? { 'anthropic-dangerous-direct-browser-access': 'true' } : {}),
      },
      body: { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] },
      timeoutMs,
      fetchImpl,
    });
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    if (!text) throw new LlmError('Anthropic returned no text', 'EMPTY');
    if (data.stop_reason === 'max_tokens') throw new LlmError('Anthropic output was cut off at the token limit', 'TRUNCATED');
    return text;
  };
}

const FACTORIES = { gemini, openai, anthropic };

/**
 * Creates a provider, or { provider: null, reason } when none is usable.
 * @param {{provider:string, apiKey:string, model?:string, baseUrl?:string, timeoutMs?:number, fetchImpl?:Function, browser?:boolean}} config
 */
export function createLlmProvider(config) {
  const { provider, apiKey } = config;
  if (!provider || provider === 'none') return { provider: null, reason: 'No LLM provider configured' };
  const factory = FACTORIES[provider];
  if (!factory) return { provider: null, reason: `Unknown LLM provider "${provider}". Use gemini, openai or anthropic` };
  if (!apiKey) return { provider: null, reason: `LLM provider is "${provider}" but no API key is set` };
  const model = config.model || LLM_PROVIDERS[provider].defaultModel;
  return {
    provider: { name: provider, model, generate: factory({ ...config, model, timeoutMs: config.timeoutMs || 90000 }) },
    reason: '',
  };
}
