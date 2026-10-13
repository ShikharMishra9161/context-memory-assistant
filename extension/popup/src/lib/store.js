// Local-first storage for saved handoffs (chrome.storage.local). When the user
// enables sync, records are also pushed to the backend; a failed request
// never loses the local copy — it is marked and retried on the next sync.
import { apiFetch, getSettings } from '../../../lib/settings.js';

const KEY = 'cma.handoffs';
const DELETES_KEY = 'cma.pendingRemoteDeletes';
const DRAFT_KEY = 'cma.draft';

async function readAll() {
  const data = await chrome.storage.local.get(KEY);
  return Array.isArray(data[KEY]) ? data[KEY] : [];
}

async function writeAll(list) {
  await chrome.storage.local.set({ [KEY]: list });
}

export async function listHandoffs(query = '') {
  const q = query.trim().toLowerCase();
  const all = (await readAll()).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  if (!q) return all;
  return all.filter(h => [h.title, h.projectName, h.markdown, h.platform].some(v => String(v || '').toLowerCase().includes(q)));
}

export async function getHandoff(id) {
  return (await readAll()).find(h => h.id === id) || null;
}

const SYNC_FIELDS = ['title', 'projectName', 'mode', 'platform', 'sourceUrl', 'conversationId', 'markdown', 'handoff', 'messageCount', 'complete', 'warnings'];

/** Creates (no id) or updates (with id) a handoff locally, then syncs if enabled. */
export async function saveHandoff(input) {
  const list = await readAll();
  const now = new Date().toISOString();
  let record;
  const idx = input.id ? list.findIndex(h => h.id === input.id) : -1;
  if (idx >= 0) {
    record = { ...list[idx], ...input, updatedAt: now, version: (list[idx].version || 1) + 1 };
    list[idx] = record;
  } else {
    record = { ...input, id: crypto.randomUUID(), remoteId: null, createdAt: now, updatedAt: now, version: 1 };
    list.push(record);
  }
  record.syncState = 'local';
  record.syncError = '';
  await writeAll(list);
  return (await syncOne(record.id)) || record;
}

async function patchLocal(id, patch) {
  const list = await readAll();
  const idx = list.findIndex(h => h.id === id);
  if (idx < 0) return null;
  list[idx] = { ...list[idx], ...patch };
  await writeAll(list);
  return list[idx];
}

/** Pushes one record to the backend when sync is enabled. Returns the updated record. */
export async function syncOne(id) {
  const settings = await getSettings();
  const record = await getHandoff(id);
  if (!record || !settings.syncToBackend) return record;
  const body = { clientId: record.id };
  for (const f of SYNC_FIELDS) if (record[f] !== undefined && record[f] !== null) body[f] = record[f];
  try {
    let remote;
    if (record.remoteId) {
      try {
        const { clientId, ...patch } = body; // eslint-disable-line no-unused-vars
        remote = await apiFetch(`/handoffs/${encodeURIComponent(record.remoteId)}`, { method: 'PUT', body: patch });
      } catch (err) {
        if (err.status !== 404) throw err;
        remote = await apiFetch('/handoffs', { method: 'POST', body });
      }
    } else {
      remote = await apiFetch('/handoffs', { method: 'POST', body });
    }
    return await patchLocal(id, { remoteId: remote.id, syncState: 'synced', syncError: '' });
  } catch (err) {
    return await patchLocal(id, { syncState: 'error', syncError: err.message });
  }
}

export async function deleteHandoff(id) {
  const list = await readAll();
  const record = list.find(h => h.id === id);
  await writeAll(list.filter(h => h.id !== id));
  if (record?.remoteId) {
    try {
      await apiFetch(`/handoffs/${encodeURIComponent(record.remoteId)}`, { method: 'DELETE' });
    } catch (err) {
      if (err.status !== 404) {
        const data = await chrome.storage.local.get(DELETES_KEY);
        await chrome.storage.local.set({ [DELETES_KEY]: [...(data[DELETES_KEY] || []), record.remoteId] });
      }
    }
  }
}

export async function duplicateHandoff(id) {
  const src = await getHandoff(id);
  if (!src) return null;
  const { id: _id, remoteId, createdAt, updatedAt, version, syncState, syncError, ...rest } = src; // eslint-disable-line no-unused-vars
  return saveHandoff({ ...rest, title: `${src.title} (copy)` });
}

/**
 * Two-way sync: retries pending deletes, pushes unsynced records, and imports
 * records that exist only on the server (e.g. from another device with the same token).
 */
export async function syncAll() {
  const settings = await getSettings();
  if (!settings.syncToBackend) return { pushed: 0, pulled: 0, errors: 0 };

  const data = await chrome.storage.local.get(DELETES_KEY);
  const remaining = [];
  for (const rid of data[DELETES_KEY] || []) {
    try { await apiFetch(`/handoffs/${encodeURIComponent(rid)}`, { method: 'DELETE' }); }
    catch (err) { if (err.status !== 404) remaining.push(rid); }
  }
  await chrome.storage.local.set({ [DELETES_KEY]: remaining });

  let pushed = 0;
  let errors = 0;
  for (const h of await readAll()) {
    if (h.syncState === 'synced') continue;
    const r = await syncOne(h.id);
    if (r?.syncState === 'synced') pushed++; else errors++;
  }

  const remote = await apiFetch('/handoffs?limit=200');
  const local = await readAll();
  const known = new Set(local.flatMap(h => [h.id, h.remoteId]).filter(Boolean));
  let pulled = 0;
  for (const s of remote.items) {
    if (known.has(s.id) || known.has(s.clientId)) continue;
    const full = await apiFetch(`/handoffs/${encodeURIComponent(s.id)}`);
    local.push({
      ...Object.fromEntries(SYNC_FIELDS.map(f => [f, full[f]])),
      id: full.clientId || crypto.randomUUID(),
      remoteId: full.id,
      createdAt: full.createdAt,
      updatedAt: full.updatedAt,
      version: full.version,
      syncState: 'synced',
      syncError: '',
    });
    pulled++;
  }
  await writeAll(local);
  return { pushed, pulled, errors };
}

// ---------------------------------------------------------------------------
// Working draft — survives the popup closing (e.g. when a new tab opens).
// ---------------------------------------------------------------------------

export async function loadDraft() {
  const data = await chrome.storage.local.get(DRAFT_KEY);
  return data[DRAFT_KEY] || null;
}

export async function saveDraft(draft) {
  await chrome.storage.local.set({ [DRAFT_KEY]: draft });
}

export async function clearDraft() {
  await chrome.storage.local.remove(DRAFT_KEY);
}
