// Settings, per-install access token and backend client. Plain ES module shared
// by the service worker (loaded as a module) and the popup (bundled by Vite).

export const DEFAULT_SETTINGS = {
  apiBase: 'http://localhost:4000',
  // Remote features are opt-in: conversation content leaves the browser only after consent.
  // aiMode: 'off' (built-in generator) | 'backend' (your server's LLM) | 'byok' (your own API key, called directly)
  aiMode: 'off',
  byok: { provider: 'gemini', apiKey: '', model: '' },
  syncToBackend: false,
  consentVersion: 0,
  defaultMode: 'continue',
  loadHistory: true,
  maxPartChars: 30000,
  // The legacy on-page "Inject Context" button is hidden unless the user turns it on.
  showInjectButton: false,
};

export const CONSENT_VERSION = 2;
const SETTINGS_KEY = 'cma.settings';
const TOKEN_KEY = 'cma.clientToken';

// Older versions stored a boolean useBackendAI instead of aiMode.
function migrate(stored) {
  const s = { ...stored };
  if (s.aiMode === undefined && s.useBackendAI !== undefined) s.aiMode = s.useBackendAI ? 'backend' : 'off';
  delete s.useBackendAI;
  return s;
}

export async function getSettings() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  const stored = migrate(data[SETTINGS_KEY] || {});
  return { ...DEFAULT_SETTINGS, ...stored, byok: { ...DEFAULT_SETTINGS.byok, ...(stored.byok || {}) } };
}

export async function saveSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch, byok: { ...current.byok, ...(patch.byok || {}) } };
  if (typeof next.apiBase === 'string') next.apiBase = next.apiBase.trim().replace(/\/+$/, '');
  if (typeof next.byok.apiKey === 'string') next.byok.apiKey = next.byok.apiKey.trim();
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

/** True when handoff generation sends the conversation anywhere outside the browser. */
export function usesRemoteAI(settings) {
  return settings.aiMode === 'backend' || settings.aiMode === 'byok';
}

/**
 * Asks Chrome for access to an origin (needs a user gesture). Backend and AI
 * provider origins are optional permissions, so nothing is granted at install.
 * Resolves false when the user declines; requests may still work via CORS.
 */
export async function requestOriginAccess(url) {
  try {
    // Match patterns without a port cover every port on that host.
    const { protocol, hostname } = new URL(url);
    const origin = `${protocol}//${hostname}/*`;
    if (!chrome.permissions?.request) return true;
    if (await chrome.permissions.contains({ origins: [origin] })) return true;
    return await chrome.permissions.request({ origins: [origin] });
  } catch {
    return false;
  }
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
