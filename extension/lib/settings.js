// Settings, per-install access token and backend client. Plain ES module shared
// by the service worker (loaded as a module) and the popup (bundled by Vite).

export const DEFAULT_SETTINGS = {
  apiBase: 'http://localhost:4000',
  // Both remote features are opt-in: conversation content leaves the browser only after consent.
  useBackendAI: false,
  syncToBackend: false,
  consentVersion: 0,
  defaultMode: 'continue',
  loadHistory: true,
  maxPartChars: 30000,
};

export const CONSENT_VERSION = 1;
const SETTINGS_KEY = 'cma.settings';
const TOKEN_KEY = 'cma.clientToken';

export async function getSettings() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] || {}) };
}

export async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  if (typeof next.apiBase === 'string') next.apiBase = next.apiBase.trim().replace(/\/+$/, '');
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Random 256-bit secret identifying this installation to the backend.
 * The backend stores only its SHA-256 hash and scopes all data to it.
 */
export async function getClientToken() {
  const data = await chrome.storage.local.get(TOKEN_KEY);
  if (data[TOKEN_KEY]) return data[TOKEN_KEY];
  const token = randomToken();
  await chrome.storage.local.set({ [TOKEN_KEY]: token });
  // Re-read in case another extension context created one concurrently.
  const again = await chrome.storage.local.get(TOKEN_KEY);
  return again[TOKEN_KEY];
}

export async function setClientToken(token) {
  if (!/^[a-f0-9]{64}$/i.test(token)) throw new Error('Access token must be 64 hexadecimal characters.');
  await chrome.storage.local.set({ [TOKEN_KEY]: token.toLowerCase() });
}

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'NETWORK', details } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** JSON request to the backend with auth header and timeout. Throws ApiError. */
export async function apiFetch(path, { method = 'GET', body, timeoutMs = 20000, apiBase } = {}) {
  const base = apiBase || (await getSettings()).apiBase;
  const token = await getClientToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new ApiError(`The backend did not respond within ${Math.round(timeoutMs / 1000)}s.`, { code: 'TIMEOUT' });
    throw new ApiError(`Cannot reach the backend at ${base}. Is it running?`, { code: 'NETWORK' });
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    throw new ApiError(data?.error || `Backend error (HTTP ${res.status})`, { status: res.status, code: data?.code || 'HTTP_ERROR', details: data?.details });
  }
  return data;
}
