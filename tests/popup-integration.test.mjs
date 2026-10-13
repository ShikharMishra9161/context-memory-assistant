// Runs the popup's real storage/sync/generation modules against the real
// backend app (in-memory store), with chrome.storage stubbed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { prepareExtraction } from '../shared/handoff-core/index.js';

const require = createRequire(import.meta.url);
const { createApp } = require('../backend/src/app.js');
const { loadConfig } = require('../backend/src/config.js');
const { createMemoryHandoffStore } = require('../backend/src/stores/handoffStore.js');

// --- chrome.storage.local stub -------------------------------------------------
const storage = new Map();
globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        const list = keys == null ? [...storage.keys()] : Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(list.filter(k => storage.has(k)).map(k => [k, structuredClone(storage.get(k))]));
      },
      async set(obj) { for (const [k, v] of Object.entries(obj)) storage.set(k, structuredClone(v)); },
      async remove(k) { storage.delete(k); },
    },
  },
};

const settingsMod = await import('../extension/lib/settings.js');
const store = await import('../extension/popup/src/lib/store.js');
const { generateHandoff } = await import('../extension/popup/src/lib/generate.js');

const silent = { log() {}, warn() {}, error() {} };
async function startBackend({ llm = null, handoffStore = createMemoryHandoffStore() } = {}) {
  const config = loadConfig({});
  const app = createApp({ config, handoffStore, llm, logger: silent });
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  await settingsMod.saveSettings({ apiBase: base });
  return { base, handoffStore, close: () => new Promise(r => server.close(r)) };
}

const extraction = prepareExtraction({
  platform: 'claude', title: 'Integration chat', url: 'https://claude.ai/chat/1',
  messages: [
    { role: 'user', text: 'Set up CI. We must use GitHub Actions.' },
    { role: 'assistant', text: 'Add `.github/workflows/ci.yml`:\n\n```yaml\non: [push]\n```\n\nNext step: add a lint job.' },
  ],
});

function sample(title = 'CI work') {
  return { title, projectName: 'Infra', mode: 'continue', platform: 'claude', markdown: '# Handoff\nGitHub Actions', messageCount: 2, complete: true, warnings: [] };
}

test.beforeEach(() => storage.clear());

test('client token is generated once, is 256-bit hex, and can be imported', async () => {
  const t1 = await settingsMod.getClientToken();
  assert.match(t1, /^[a-f0-9]{64}$/);
  assert.equal(await settingsMod.getClientToken(), t1);
  await assert.rejects(settingsMod.setClientToken('nope'), /64 hexadecimal/);
  const other = 'a'.repeat(64);
  await settingsMod.setClientToken(other);
  assert.equal(await settingsMod.getClientToken(), other);
});

test('remote features are off by default (consent required)', async () => {
  const s = await settingsMod.getSettings();
  assert.equal(s.aiMode, 'off');
  assert.equal(s.showInjectButton, false);
  assert.equal(s.syncToBackend, false);
  assert.equal(s.apiBase, 'http://localhost:4000');
});

test('local-first store: save, search, edit, duplicate, delete without any backend', async () => {
  const saved = await store.saveHandoff(sample());
  assert.equal(saved.syncState, 'local');
  assert.equal(saved.remoteId, null);
  const edited = await store.saveHandoff({ id: saved.id, title: 'CI work v2', markdown: '# Handoff\nupdated' });
  assert.equal(edited.version, 2);
  assert.equal(edited.projectName, 'Infra', 'unchanged fields are kept');
  assert.equal((await store.listHandoffs('updated')).length, 1);
  assert.equal((await store.listHandoffs('nothing-matches')).length, 0);
  const dup = await store.duplicateHandoff(saved.id);
  assert.equal(dup.title, 'CI work v2 (copy)');
  assert.equal((await store.listHandoffs()).length, 2);
  await store.deleteHandoff(saved.id);
  assert.deepEqual((await store.listHandoffs()).map(h => h.id), [dup.id]);
});

test('sync: saves upload; a failed request keeps the local copy and is retried later', async () => {
  const backend = await startBackend();
  await settingsMod.saveSettings({ syncToBackend: true });
  try {
    const saved = await store.saveHandoff(sample());
    assert.equal(saved.syncState, 'synced');
    assert.ok(saved.remoteId);
    const edited = await store.saveHandoff({ id: saved.id, title: 'Renamed' });
    assert.equal(edited.syncState, 'synced');
    const token = await settingsMod.getClientToken();
    const remote = await (await fetch(`${backend.base}/handoffs/${saved.remoteId}`, { headers: { Authorization: `Bearer ${token}` } })).json();
    assert.equal(remote.title, 'Renamed');
  } finally { await backend.close(); }

  // Backend is down now.
  const offline = await store.saveHandoff(sample('Written offline'));
  assert.equal(offline.syncState, 'error');
  assert.match(offline.syncError, /Cannot reach the backend/);
  assert.ok((await store.getHandoff(offline.id)).markdown, 'local copy kept');

  const back = await startBackend();
  try {
    const result = await store.syncAll();
    assert.equal(result.errors, 0);
    assert.ok(result.pushed >= 1);
    assert.equal((await store.getHandoff(offline.id)).syncState, 'synced');
  } finally { await back.close(); }
});

test('sync pulls handoffs that only exist on the server (same token, another device)', async () => {
  const backend = await startBackend();
  await settingsMod.saveSettings({ syncToBackend: true });
  try {
    const token = await settingsMod.getClientToken();
    await fetch(`${backend.base}/handoffs`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'From laptop', markdown: '# remote', clientId: 'laptop-1' }),
    });
    const r = await store.syncAll();
    assert.equal(r.pulled, 1);
    const pulled = (await store.listHandoffs()).find(h => h.title === 'From laptop');
    assert.equal(pulled.markdown, '# remote');
    assert.equal(pulled.syncState, 'synced');
    assert.equal((await store.syncAll()).pulled, 0, 'second sync does not duplicate');
  } finally { await backend.close(); }
});

test('remote delete failures are queued and retried on the next sync', async () => {
  const backend = await startBackend();
  await settingsMod.saveSettings({ syncToBackend: true });
  const saved = await store.saveHandoff(sample());
  await backend.close();
  await store.deleteHandoff(saved.id);
  assert.deepEqual((await chrome.storage.local.get('cma.pendingRemoteDeletes'))['cma.pendingRemoteDeletes'], [saved.remoteId]);
  const back = await startBackend({ handoffStore: backend.handoffStore });
  try {
    await store.syncAll();
    assert.deepEqual((await chrome.storage.local.get('cma.pendingRemoteDeletes'))['cma.pendingRemoteDeletes'], []);
    const token = await settingsMod.getClientToken();
    const res = await fetch(`${back.base}/handoffs/${saved.remoteId}`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(res.status, 404);
  } finally { await back.close(); }
});

test('generation: local when AI is off, backend when on, local fallback when backend fails', async () => {
  const off = await generateHandoff({ extraction, mode: 'continue', projectName: 'Infra', customInstructions: '', settings: { aiMode: 'off' } });
  assert.equal(off.generator.type, 'deterministic');
  assert.match(off.generator.fallbackReason, /turned off/);
  assert.match(off.markdown, /```yaml\non: \[push\]\n```/);

  const llm = { name: 'fake', model: 'x', generate: async () => JSON.stringify({ nextSteps: { next: 'Add a lint job' } }) };
  const backend = await startBackend({ llm });
  try {
    const on = await generateHandoff({ extraction, mode: 'continue', projectName: 'Infra', customInstructions: '', settings: { aiMode: 'backend' } });
    assert.equal(on.generator.type, 'llm');
    assert.equal(on.handoff.nextSteps.next, 'Add a lint job');
  } finally { await backend.close(); }

  const down = await generateHandoff({ extraction, mode: 'quick', projectName: '', customInstructions: '', settings: { aiMode: 'backend' } });
  assert.equal(down.generator.type, 'deterministic');
  assert.match(down.notice, /AI generation failed/);
  assert.match(down.markdown, /backend unavailable/);
});

test('settings migrate the old useBackendAI flag to aiMode', async () => {
  await chrome.storage.local.set({ 'cma.settings': { useBackendAI: true, apiBase: 'http://x:1' } });
  const s = await settingsMod.getSettings();
  assert.equal(s.aiMode, 'backend');
  assert.equal(s.useBackendAI, undefined);
  assert.deepEqual(s.byok, { provider: 'gemini', apiKey: '', model: '' });
  const saved = await settingsMod.saveSettings({ byok: { apiKey: '  k  ' } });
  assert.deepEqual(saved.byok, { provider: 'gemini', apiKey: 'k', model: '' }, 'partial byok patch keeps other fields and trims the key');
});

test('own API key: calls the provider directly from the browser and falls back on failure', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, headers: init.headers });
    return { ok: true, status: 200, text: async () => JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ nextSteps: { next: 'Add a lint job (from Claude)' } }) }], stop_reason: 'end_turn' }) };
  };
  try {
    const settings = { aiMode: 'byok', byok: { provider: 'anthropic', apiKey: 'sk-test', model: '' } };
    const r = await generateHandoff({ extraction, mode: 'continue', projectName: 'Infra', customInstructions: '', settings });
    assert.equal(r.generator.type, 'llm');
    assert.equal(r.generator.provider, 'anthropic');
    assert.equal(r.handoff.nextSteps.next, 'Add a lint job (from Claude)');
    assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
    assert.equal(calls[0].headers['x-api-key'], 'sk-test');
    assert.equal(calls[0].headers['anthropic-dangerous-direct-browser-access'], 'true');

    globalThis.fetch = async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ error: { message: 'invalid x-api-key' } }) });
    const bad = await generateHandoff({ extraction, mode: 'continue', projectName: '', customInstructions: '', settings });
    assert.equal(bad.generator.type, 'deterministic');
    assert.match(bad.notice, /Anthropic Claude could not generate/);
    assert.match(bad.markdown, /AUTH/);

    const noKey = await generateHandoff({ extraction, mode: 'continue', projectName: '', customInstructions: '', settings: { aiMode: 'byok', byok: { provider: 'gemini', apiKey: '' } } });
    assert.equal(noKey.generator.type, 'deterministic');
    assert.match(noKey.notice, /no API key/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
