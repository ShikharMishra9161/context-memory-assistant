// LLM provider abstraction. Each provider exposes
//   generate({ system, prompt, maxTokens }) -> Promise<string>
// and throws LlmError with a stable `code` on failure. Plain fetch, no SDKs.

class LlmError extends Error {
  constructor(message, code = 'UPSTREAM', status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const DEFAULT_MODELS = {
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-4.1-mini',
  anthropic: 'claude-sonnet-5-5',
};

async function postJson(url, { headers, body, timeoutMs, fetchImpl = fetch }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(url, {
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

function geminiProvider({ apiKey, model, timeoutMs, baseUrl, fetchImpl }) {
  const base = baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
  return {
    name: 'gemini',
    model,
    async generate({ system, prompt, maxTokens }) {
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
    },
  };
}

function openaiProvider({ apiKey, model, timeoutMs, baseUrl, fetchImpl }) {
  const base = baseUrl || 'https://api.openai.com/v1';
  return {
    name: 'openai',
    model,
    async generate({ system, prompt, maxTokens }) {
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
    },
  };
}

function anthropicProvider({ apiKey, model, timeoutMs, baseUrl, fetchImpl }) {
  const base = baseUrl || 'https://api.anthropic.com/v1';
  return {
    name: 'anthropic',
    model,
    async generate({ system, prompt, maxTokens }) {
      const data = await postJson(`${base}/messages`, {
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] },
        timeoutMs,
        fetchImpl,
      });
      const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
      if (!text) throw new LlmError('Anthropic returned no text', 'EMPTY');
      if (data.stop_reason === 'max_tokens') throw new LlmError('Anthropic output was cut off at the token limit', 'TRUNCATED');
      return text;
    },
  };
}

const FACTORIES = { gemini: geminiProvider, openai: openaiProvider, anthropic: anthropicProvider };

/**
 * Creates the configured provider, or returns { provider: null, reason } when
 * none is usable so callers can fall back to deterministic generation.
 */
function createLlmProvider(llmConfig, { fetchImpl } = {}) {
  const { provider, apiKey } = llmConfig;
  if (!provider || provider === 'none') {
    return { provider: null, reason: 'No LLM provider configured. Set LLM_PROVIDER and the matching API key in backend/.env.' };
  }
  const factory = FACTORIES[provider];
  if (!factory) return { provider: null, reason: `Unknown LLM_PROVIDER "${provider}". Use gemini, openai or anthropic.` };
  if (!apiKey) return { provider: null, reason: `LLM_PROVIDER is "${provider}" but no API key is set.` };
  return {
    provider: factory({
      apiKey,
      model: llmConfig.model || DEFAULT_MODELS[provider],
      timeoutMs: llmConfig.timeoutMs,
      baseUrl: llmConfig.baseUrl,
      fetchImpl,
    }),
    reason: '',
  };
}

module.exports = { createLlmProvider, LlmError, DEFAULT_MODELS };
