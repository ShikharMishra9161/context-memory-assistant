const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createApp, isAllowedOrigin } = require('../src/app');
const { loadConfig } = require('../src/config');
const { createMemoryHandoffStore } = require('../src/stores/handoffStore');

const silent = { log() {}, warn() {}, error() {} };
const token = () => crypto.randomBytes(32).toString('hex');

function config(overrides = {}) {
  const c = loadConfig({ PORT: '0' });
  c.rateLimit = { windowMs: 60000, max: 1000, generateMax: 1000 };
  return { ...c, ...overrides };
}

async function start({ config: overrides, ...deps } = {}) {
  const app = createApp({ config: config(overrides), handoffStore: createMemoryHandoffStore(), llm: null, logger: silent, ...deps });
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, { method = 'GET', body, auth, headers = {} } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json, headers: res.headers };
  };
  return { call, close: () => new Promise(r => server.close(r)) };
}

const sampleExtraction = (messages) => ({
  platform: 'chatgpt',
  title: 'Sample',
  url: 'https://chatgpt.com/c/abc',
  conversationId: 'abc',
  extractedAt: new Date().toISOString(),
  complete: true,
  warnings: [],
  messages: messages || [
    { role: 'user', text: 'Build an Express API. We must not use TypeScript.' },
    { role: 'assistant', text: 'Create `src/index.js`:\n\n```js\nconst app = require("express")();\napp.listen(4000);\n```' },
    { role: 'user', text: 'Running it fails:\nError: Cannot find module \'express\'\n    at Module._resolveFilename (node:internal/modules/cjs/loader:1140:15)' },
    { role: 'assistant', text: 'Run `npm install express` and start again. Next step: add a /health route.' },
  ],
});

test('health is public and reports LLM status without secrets', async () => {
  const s = await start();
  try {
    const r = await s.call('/health');
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'ok');
    assert.equal(r.body.llm.configured, false);
    assert.ok(!JSON.stringify(r.body).toLowerCase().includes('key='));
  } finally { await s.close(); }
});

test('protected routes require a well-formed bearer token', async () => {
  const s = await start();
  try {
    assert.equal((await s.call('/handoffs')).status, 401);
    assert.equal((await s.call('/handoffs', { auth: 'short' })).status, 401);
    assert.equal((await s.call('/generate', { method: 'POST', body: {} })).status, 401);
    assert.equal((await s.call('/handoffs', { auth: token() })).status, 200);
  } finally { await s.close(); }
});

test('CORS: rejects unknown web origins, allows extensions and configured dashboard', async () => {
  const cfg = config({ allowedOrigins: ['http://localhost:3000'], allowedExtensionIds: [] });
  assert.equal(isAllowedOrigin(undefined, cfg), true);
  assert.equal(isAllowedOrigin('chrome-extension://abcdefghijklmnopabcdefghijklmnop', cfg), true);
  assert.equal(isAllowedOrigin('http://localhost:3000', cfg), true);
  assert.equal(isAllowedOrigin('https://evil.example', cfg), false);
  const pinned = { ...cfg, allowedExtensionIds: ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'] };
  assert.equal(isAllowedOrigin('chrome-extension://abcdefghijklmnopabcdefghijklmnop', pinned), false);

  const s = await start();
  try {
    const r = await s.call('/handoffs', { auth: token(), headers: { Origin: 'https://evil.example' } });
    assert.equal(r.status, 403);
  } finally { await s.close(); }
});

test('handoff CRUD: create, get, list, search, update, duplicate, markdown download, delete', async () => {
  const s = await start();
  const t = token();
  try {
    const created = await s.call('/handoffs', { method: 'POST', auth: t, body: { title: 'Auth work', projectName: 'CMA', markdown: '# Context handoff\nJWT refresh flow', mode: 'continue', messageCount: 12, complete: false, warnings: ['partial'] } });
    assert.equal(created.status, 201);
    const id = created.body.id;
    assert.ok(id);
    assert.equal(created.body.ownerId, undefined, 'ownerId must never be returned');

    const got = await s.call(`/handoffs/${id}`, { auth: t });
    assert.equal(got.body.markdown, '# Context handoff\nJWT refresh flow');
    assert.equal(got.body.complete, false);

    await s.call('/handoffs', { method: 'POST', auth: t, body: { title: 'Other', markdown: 'unrelated' } });
    const search = await s.call('/handoffs?q=jwt', { auth: t });
    assert.equal(search.body.total, 1);
    assert.equal(search.body.items[0].id, id);
    assert.equal(search.body.items[0].markdown, undefined, 'list returns summaries only');

    const updated = await s.call(`/handoffs/${id}`, { method: 'PUT', auth: t, body: { title: 'Auth work v2', markdown: '# updated' } });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.title, 'Auth work v2');
    assert.equal(updated.body.version, 2);

    const dup = await s.call(`/handoffs/${id}/duplicate`, { method: 'POST', auth: t });
    assert.equal(dup.status, 201);
    assert.notEqual(dup.body.id, id);
    assert.equal(dup.body.title, 'Auth work v2 (copy)');

    const md = await s.call(`/handoffs/${id}/markdown`, { auth: t });
    assert.equal(md.status, 200);
    assert.match(md.headers.get('content-disposition'), /cma-handoff\.md/);
    assert.equal(md.body, '# updated');

    assert.equal((await s.call(`/handoffs/${id}`, { method: 'DELETE', auth: t })).status, 200);
    assert.equal((await s.call(`/handoffs/${id}`, { auth: t })).status, 404);
    assert.equal((await s.call(`/handoffs/${id}`, { method: 'DELETE', auth: t })).status, 404);
  } finally { await s.close(); }
});

test('handoffs are isolated between install tokens', async () => {
  const s = await start();
  const alice = token();
  const bob = token();
  try {
    const { body } = await s.call('/handoffs', { method: 'POST', auth: alice, body: { title: 'Secret', markdown: 'private' } });
    assert.equal((await s.call(`/handoffs/${body.id}`, { auth: bob })).status, 404);
    assert.equal((await s.call(`/handoffs/${body.id}`, { method: 'PUT', auth: bob, body: { title: 'x' } })).status, 404);
    assert.equal((await s.call(`/handoffs/${body.id}`, { method: 'DELETE', auth: bob })).status, 404);
    assert.equal((await s.call('/handoffs', { auth: bob })).body.total, 0);
    assert.equal((await s.call(`/handoffs/${body.id}`, { auth: alice })).status, 200);
  } finally { await s.close(); }
});

test('create with the same clientId is idempotent (safe sync retries)', async () => {
  const s = await start();
  const t = token();
  try {
    const a = await s.call('/handoffs', { method: 'POST', auth: t, body: { title: 'One', markdown: 'a', clientId: 'local-1' } });
    const b = await s.call('/handoffs', { method: 'POST', auth: t, body: { title: 'One edited', markdown: 'b', clientId: 'local-1' } });
    assert.equal(a.status, 201);
    assert.equal(b.status, 200);
    assert.equal(a.body.id, b.body.id);
    assert.equal((await s.call('/handoffs', { auth: t })).body.total, 1);
  } finally { await s.close(); }
});

test('validation errors return 400 with details', async () => {
  const s = await start();
  const t = token();
  try {
    const noTitle = await s.call('/handoffs', { method: 'POST', auth: t, body: { markdown: 'x' } });
    assert.equal(noTitle.status, 400);
    assert.equal(noTitle.body.code, 'VALIDATION');
    const badMode = await s.call('/handoffs', { method: 'POST', auth: t, body: { title: 't', markdown: 'x', mode: 'bogus' } });
    assert.equal(badMode.status, 400);
    const badJson = await s.call('/handoffs', { method: 'POST', auth: t, body: '{not json' });
    assert.equal(badJson.status, 400);
    assert.equal(badJson.body.code, 'INVALID_JSON');
    const mass = await s.call('/handoffs', { method: 'POST', auth: t, body: { title: 't', markdown: 'x', ownerId: 'someone-else' } });
    assert.equal(mass.status, 201);
    assert.equal((await s.call(`/handoffs/${mass.body.id}`, { auth: t })).status, 200, 'ownerId in body is ignored');
    const empty = await s.call('/generate', { method: 'POST', auth: t, body: { mode: 'continue', extraction: sampleExtraction([]) } });
    assert.equal(empty.status, 400);
    const badRole = await s.call('/generate', { method: 'POST', auth: t, body: { extraction: sampleExtraction([{ role: 'robot', text: 'x' }]) } });
    assert.equal(badRole.status, 400);
    const customNoText = await s.call('/generate', { method: 'POST', auth: t, body: { mode: 'custom', extraction: sampleExtraction() } });
    assert.equal(customNoText.status, 400);
  } finally { await s.close(); }
});

test('oversized request bodies are rejected with 413', async () => {
  const s = await start({ config: { jsonLimit: '10kb' } });
  try {
    const big = await s.call('/handoffs', { method: 'POST', auth: token(), body: { title: 't', markdown: 'x'.repeat(20000) } });
    assert.equal(big.status, 413);
    assert.equal(big.body.code, 'PAYLOAD_TOO_LARGE');
  } finally { await s.close(); }
});

test('rate limiter returns 429 after the configured maximum', async () => {
  const s = await start({ config: { rateLimit: { windowMs: 60000, max: 3, generateMax: 1 } } });
  const t = token();
  try {
    for (let i = 0; i < 3; i++) assert.equal((await s.call('/handoffs', { auth: t })).status, 200);
    const limited = await s.call('/handoffs', { auth: t });
    assert.equal(limited.status, 429);
    assert.ok(limited.headers.get('retry-after'));
  } finally { await s.close(); }
});

test('storage endpoints return 503 when the database is down', async () => {
  const store = { ...createMemoryHandoffStore(), isReady: () => false };
  const s = await start({ handoffStore: store });
  try {
    const r = await s.call('/handoffs', { auth: token() });
    assert.equal(r.status, 503);
    assert.equal(r.body.code, 'DB_UNAVAILABLE');
  } finally { await s.close(); }
});

test('generate without an LLM returns a deterministic handoff and says why', async () => {
  const s = await start({ llm: null });
  try {
    const r = await s.call('/generate', { method: 'POST', auth: token(), body: { mode: 'continue', projectName: 'API', extraction: sampleExtraction() } });
    assert.equal(r.status, 200);
    assert.equal(r.body.generator.type, 'deterministic');
    assert.ok(r.body.generator.fallbackReason);
    assert.match(r.body.markdown, /Cannot find module 'express'/);
    assert.match(r.body.markdown, /app\.listen\(4000\)/);
    assert.equal(r.body.handoff.project.name, 'API');
    assert.equal(r.body.handoff.meta.extraction.messageCount, 4);
  } finally { await s.close(); }
});

test('generate with a failing LLM falls back to deterministic output', async () => {
  const llm = { name: 'fake', model: 'broken', generate: async () => { const e = new Error('boom'); e.code = 'UPSTREAM'; throw e; } };
  const s = await start({ llm });
  try {
    const r = await s.call('/generate', { method: 'POST', auth: token(), body: { extraction: sampleExtraction() } });
    assert.equal(r.status, 200);
    assert.equal(r.body.generator.type, 'deterministic');
    assert.match(r.body.generator.fallbackReason, /AI provider failed/);
    assert.match(r.body.markdown, /deterministic extraction/);
  } finally { await s.close(); }
});

test('generate with a malformed LLM response falls back', async () => {
  const llm = { name: 'fake', model: 'm', generate: async () => 'Sorry, I cannot help with that.' };
  const s = await start({ llm });
  try {
    const r = await s.call('/generate', { method: 'POST', auth: token(), body: { extraction: sampleExtraction() } });
    assert.equal(r.body.generator.type, 'deterministic');
  } finally { await s.close(); }
});

test('generate with a working LLM merges model output with verbatim artifacts', async () => {
  const prompts = [];
  const llm = {
    name: 'fake', model: 'fake-1',
    generate: async ({ prompt }) => {
      prompts.push(prompt);
      return '```json\n' + JSON.stringify({
        project: { purpose: 'An Express API', stack: [{ text: 'Express', status: 'confirmed', refs: [1] }] },
        decisions: { constraints: [{ text: 'No TypeScript', status: 'confirmed', refs: [1] }] },
        currentTask: { goal: 'Fix missing express module', stoppedAt: 'Told to npm install express' },
        nextSteps: { next: 'Add a /health route' },
      }) + '\n```';
    },
  };
  const s = await start({ llm });
  try {
    const r = await s.call('/generate', { method: 'POST', auth: token(), body: { mode: 'full', extraction: sampleExtraction() } });
    assert.equal(r.status, 200);
    assert.equal(r.body.generator.type, 'llm');
    assert.equal(r.body.generator.chunks, 1);
    assert.equal(r.body.handoff.decisions.constraints[0].refs[0], 0, 'refs converted to 0-based');
    assert.equal(r.body.handoff.nextSteps.next, 'Add a /health route');
    assert.match(r.body.markdown, /app\.listen\(4000\)/, 'code preserved even if the model omitted it');
    assert.match(r.body.markdown, /Appendix: conversation transcript/, 'full mode includes the transcript');
    assert.ok(!prompts[0].includes('undefined'));
  } finally { await s.close(); }
});

test('long conversations are chunked and every chunk reaches the LLM', async () => {
  const seen = new Set();
  let calls = 0;
  const llm = {
    name: 'fake', model: 'm',
    generate: async ({ prompt }) => {
      calls++;
      for (const m of prompt.matchAll(/MARKER-(\d+)/g)) seen.add(Number(m[1]));
      const chunkNo = (prompt.match(/chunk (\d+) of/) || [])[1];
      return JSON.stringify({ state: { completed: [{ text: `done in chunk ${chunkNo || 'consolidate'}`, status: 'confirmed', refs: [] }] } });
    },
  };
  const messages = [];
  for (let i = 0; i < 60; i++) messages.push({ role: i % 2 ? 'assistant' : 'user', text: `MARKER-${i} ` + 'lorem ipsum '.repeat(200) });
  const cfg = config();
  cfg.llm = { ...cfg.llm, maxInputChars: 20000, maxChunks: 50, concurrency: 2 };
  const s = await start({ llm, config: cfg });
  try {
    const r = await s.call('/generate', { method: 'POST', auth: token(), body: { extraction: sampleExtraction(messages) } });
    assert.equal(r.status, 200);
    assert.equal(r.body.generator.type, 'llm');
    assert.ok(r.body.generator.chunks > 1, 'multiple chunks');
    assert.equal(seen.size, 60, 'every message was sent to the model');
    // Consolidation returned fewer items than 60% of the merge, so the mechanical merge is kept.
    assert.equal(r.body.generator.consolidated, false);
    assert.equal(r.body.handoff.state.completed.length, r.body.generator.chunks);
    assert.equal(calls, r.body.generator.chunks + 1);
  } finally { await s.close(); }
});

test('too many chunks falls back instead of silently truncating', async () => {
  const llm = { name: 'fake', model: 'm', generate: async () => { throw new Error('should not be called'); } };
  const cfg = config();
  cfg.llm = { ...cfg.llm, maxInputChars: 2000, maxChunks: 2 };
  const s = await start({ llm, config: cfg });
  const messages = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: 'x'.repeat(1500) + i }));
  try {
    const r = await s.call('/generate', { method: 'POST', auth: token(), body: { extraction: sampleExtraction(messages) } });
    assert.equal(r.body.generator.type, 'deterministic');
    assert.match(r.body.generator.fallbackReason, /LLM_MAX_CHUNKS/);
  } finally { await s.close(); }
});

test('server marks extraction partial when the client reports gaps', async () => {
  const s = await start();
  try {
    const ex = { ...sampleExtraction(), complete: false, warnings: ['Older messages may not have loaded.'] };
    const r = await s.call('/generate', { method: 'POST', auth: token(), body: { extraction: ex } });
    assert.equal(r.body.handoff.meta.extraction.complete, false);
    assert.match(r.body.markdown, /PARTIAL EXTRACTION/);
    assert.match(r.body.markdown, /Older messages may not have loaded/);
  } finally { await s.close(); }
});

test('transient LLM errors are retried before falling back', async () => {
  let calls = 0;
  const llm = {
    name: 'fake', model: 'm',
    generate: async () => {
      calls++;
      if (calls === 1) { const e = new Error('overloaded'); e.code = 'UPSTREAM'; e.status = 503; throw e; }
      return JSON.stringify({ nextSteps: { next: 'Retry worked' } });
    },
  };
  const s = await start({ llm });
  try {
    const r = await s.call('/generate', { method: 'POST', auth: token(), body: { extraction: sampleExtraction() } });
    assert.equal(r.body.generator.type, 'llm');
    assert.equal(r.body.handoff.nextSteps.next, 'Retry worked');
    assert.equal(calls, 2);
  } finally { await s.close(); }
});

test('auth errors are not retried', async () => {
  let calls = 0;
  const llm = { name: 'fake', model: 'm', generate: async () => { calls++; const e = new Error('bad key'); e.code = 'AUTH'; e.status = 401; throw e; } };
  const s = await start({ llm });
  try {
    const r = await s.call('/generate', { method: 'POST', auth: token(), body: { extraction: sampleExtraction() } });
    assert.equal(r.body.generator.type, 'deterministic');
    assert.equal(calls, 1);
    assert.doesNotMatch(r.body.markdown, /\.\./, 'no doubled punctuation in the fallback reason');
  } finally { await s.close(); }
});
