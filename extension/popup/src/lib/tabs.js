import { detectPlatform } from './platforms';

export async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

function sendToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, response => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(response);
    });
  });
}

/**
 * Makes sure the extraction scripts are running in the tab. Tabs opened before
 * the extension was installed/updated have no content scripts, so they are
 * injected on demand (idempotent — the scripts guard against double loading).
 */
async function ensureContentScripts(tab, platform) {
  try {
    const pong = await sendToTab(tab.id, { type: 'CMA_PING' });
    if (pong?.ok) return;
  } catch { /* not injected yet */ }
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content/extract-core.js', platform.adapter, 'content/extract-listener.js'],
  });
}

/**
 * Extracts the conversation in a tab. Progress events are forwarded to onProgress.
 * Resolves with the content script's result object ({ ok, ... }).
 */
export async function extractFromTab(tab, { loadHistory = true } = {}, onProgress = () => {}) {
  const platform = detectPlatform(tab?.url);
  if (!platform) {
    return { ok: false, code: 'UNSUPPORTED', error: 'Open a ChatGPT, Claude or Gemini conversation in this tab, then try again.' };
  }
  const requestId = crypto.randomUUID();
  const listener = msg => {
    if (msg?.type === 'CMA_EXTRACT_PROGRESS' && msg.requestId === requestId) onProgress(msg);
  };
  chrome.runtime.onMessage.addListener(listener);
  try {
    await ensureContentScripts(tab, platform);
    const res = await sendToTab(tab.id, { type: 'CMA_EXTRACT', requestId, options: { loadHistory } });
    return res || { ok: false, code: 'NO_RESPONSE', error: 'The page did not respond. Reload the tab and try again.' };
  } catch (err) {
    const msg = String(err?.message || err);
    if (/Cannot access|cannot be scripted|chrome:\/\//i.test(msg)) {
      return { ok: false, code: 'NO_ACCESS', error: 'The extension cannot access this page. Reload the tab and try again.' };
    }
    return { ok: false, code: 'NO_CONNECTION', error: `Could not talk to the page (${msg}). Reload the ${platform.name} tab and try again.` };
  } finally {
    chrome.runtime.onMessage.removeListener(listener);
  }
}

/** Inserts text into the chat box of a supported tab (never sends it). */
export async function insertIntoTab(tab, text) {
  const platform = detectPlatform(tab?.url);
  if (!platform) return { ok: false, error: 'This tab is not a supported AI chat.' };
  try {
    await ensureContentScripts(tab, platform);
    return (await sendToTab(tab.id, { type: 'CMA_INSERT_TEXT', text })) || { ok: false, error: 'No response from the page.' };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

export function openNewChat(platform) {
  return chrome.tabs.create({ url: platform.newChatUrl });
}
