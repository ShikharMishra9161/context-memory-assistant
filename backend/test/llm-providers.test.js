const test = require('node:test');
const assert = require('node:assert/strict');
const { createLlmProvider } = require('../src/services/llm/providers');
const { loadConfig } = require('../src/config');

function fakeFetch(status, json, capture = {}) {
  return async (url, init) => {
    capture.url = url;
    capture.init = init;
    return { ok: status < 400, status, text: async () => JSON.stringify(json) };
  };
}

const base = { timeoutMs: 1000, model: '', baseUrl: '' };

test('provider auto-detection and missing-key handling', () => {
  assert.equal(loadConfig({}).llm.provider, 'none');
  assert.equal(loadConfig({ GEMINI_API_KEY: 'g' }).llm.provider, 'gemini');
  assert.equal(loadConfig({ GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a' }).llm.provider, 'anthropic');
  assert.equal(loadConfig({ LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'o' }).llm.apiKey, 'o');
  assert.equal(createLlmProvider({ provider: 'none' }).provider, null);
  assert.match(createLlmProvider({ provider: 'openai', apiKey: '' }).reason, /no API key/);
  assert.match(createLlmProvider({ provider: 'llama', apiKey: 'x' }).reason, /Unknown/);
});

test('gemini request shape and response parsing', async () => {
  const cap = {};
  const { provider } = createLlmProvider({ ...base, provider: 'gemini', apiKey: 'KEY' }, { fetchImpl: fakeFetch(200, { candidates: [{ content: { parts: [{ text: '{"a":1}' }] }, finishReason: 'STOP' }] }, cap) });
  assert.equal(await provider.generate({ system: 's', prompt: 'p', maxTokens: 10 }), '{"a":1}');
  assert.match(cap.url, /models\/gemini-2\.5-flash:generateContent$/);
  assert.equal(cap.init.headers['x-goog-api-key'], 'KEY');
  assert.ok(!cap.url.includes('KEY'), 'API key is not placed in the URL');
});

test('openai request shape and truncation detection', async () => {
  const cap = {};
  const ok = createLlmProvider({ ...base, provider: 'openai', apiKey: 'KEY' }, { fetchImpl: fakeFetch(200, { choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] }, cap) }).provider;
  assert.equal(await ok.generate({ system: 's', prompt: 'p', maxTokens: 10 }), '{}');
  assert.equal(cap.init.headers.Authorization, 'Bearer KEY');
  assert.equal(JSON.parse(cap.init.body).response_format.type, 'json_object');
  const cut = createLlmProvider({ ...base, provider: 'openai', apiKey: 'KEY' }, { fetchImpl: fakeFetch(200, { choices: [{ message: { content: '{' }, finish_reason: 'length' }] }) }).provider;
  await assert.rejects(cut.generate({ system: 's', prompt: 'p', maxTokens: 10 }), e => e.code === 'TRUNCATED');
});

test('anthropic request shape and error mapping', async () => {
  const cap = {};
  const { provider } = createLlmProvider({ ...base, provider: 'anthropic', apiKey: 'KEY' }, { fetchImpl: fakeFetch(200, { content: [{ type: 'text', text: '{}' }], stop_reason: 'end_turn' }, cap) });
  assert.equal(await provider.generate({ system: 's', prompt: 'p', maxTokens: 10 }), '{}');
  assert.equal(cap.init.headers['x-api-key'], 'KEY');
  assert.equal(cap.init.headers['anthropic-version'], '2023-06-01');
  const body = JSON.parse(cap.init.body);
  assert.equal(body.system, 's');
  assert.equal(body.max_tokens, 10);

  for (const [status, code] of [[401, 'AUTH'], [429, 'RATE_LIMIT'], [500, 'UPSTREAM']]) {
    const p = createLlmProvider({ ...base, provider: 'anthropic', apiKey: 'K' }, { fetchImpl: fakeFetch(status, { error: { message: 'nope' } }) }).provider;
    await assert.rejects(p.generate({ system: 's', prompt: 'p', maxTokens: 1 }), e => e.code === code);
  }
});

test('timeouts surface as TIMEOUT errors', async () => {
  const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  const { provider } = createLlmProvider({ ...base, timeoutMs: 50, provider: 'openai', apiKey: 'K' }, { fetchImpl: hang });
  await assert.rejects(provider.generate({ system: 's', prompt: 'p', maxTokens: 1 }), e => e.code === 'TIMEOUT');
});
