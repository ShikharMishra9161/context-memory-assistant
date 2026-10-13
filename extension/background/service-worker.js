import { apiFetch, getClientToken } from '../lib/settings.js';

// Selector config — update here if sites change their DOM
const SELECTORS = {
  chatgpt: '#prompt-textarea',
  gemini: 'div.ql-editor[contenteditable="true"]',
  claude: 'div[contenteditable="true"].ProseMirror'
};

// Fetch memories from backend, cache in chrome.storage
async function syncMemories() {
  const memories = await apiFetch('/memory');

  await chrome.storage.local.set({
    memories,
    lastSync: Date.now()
  });

  return memories;
}

// Reply helper: run an async task and always answer the sender.
function respond(reply, task, onError) {
  task()
    .then(reply)
    .catch(async (error) => {
      console.error('[CMA]', error.message);
      reply(await onError(error));
    });
  return true;
}

// Listen for messages from content scripts / popup
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || typeof msg.type !== 'string') return;

  // Get selectors
  if (msg.type === 'GET_SELECTORS') {
    reply({ selectors: SELECTORS });
    return true;
  }

  // Get cached memories
  if (msg.type === 'GET_MEMORIES') {
    chrome.storage.local.get(['memories'], (data) => {
      reply({ memories: data.memories || [] });
    });
    return true;
  }

  // Semantic memory search, falling back to cached memories
  if (msg.type === 'SEARCH_MEMORIES') {
    return respond(
      reply,
      async () => ({
        memories: await apiFetch('/memory/search', {
          method: 'POST',
          body: { query: msg.query, topK: msg.topK || 5 }
        })
      }),
      async () => {
        const data = await chrome.storage.local.get(['memories']);
        return { memories: data.memories || [] };
      }
    );
  }

  // Force sync from backend
  if (msg.type === 'SYNC_MEMORIES') {
    return respond(
      reply,
      async () => ({ memories: await syncMemories() }),
      async (error) => {
        const data = await chrome.storage.local.get(['memories']);
        return { memories: data.memories || [], error: error.message };
      }
    );
  }

  // Save memory
  if (msg.type === 'SAVE_MEMORY') {
    return respond(
      reply,
      async () => {
        const memory = await apiFetch('/memory', { method: 'POST', body: msg.payload });
        return { success: true, memory, memories: await syncMemories() };
      },
      async (error) => ({ success: false, error: error.message })
    );
  }

  // Update memory
  if (msg.type === 'UPDATE_MEMORY') {
    return respond(
      reply,
      async () => {
        const memory = await apiFetch(`/memory/${encodeURIComponent(msg.id)}`, { method: 'PUT', body: msg.payload });
        return { success: true, memory, memories: await syncMemories() };
      },
      async (error) => ({ success: false, error: error.message })
    );
  }

  // Delete memory
  if (msg.type === 'DELETE_MEMORY') {
    return respond(
      reply,
      async () => {
        await apiFetch(`/memory/${encodeURIComponent(msg.id)}`, { method: 'DELETE' });
        return { success: true, memories: await syncMemories() };
      },
      async (error) => ({ success: false, error: error.message })
    );
  }
});

// Reload AI tabs after extension update so content scripts reconnect
const AI_TAB_PATTERNS = [
  'https://chatgpt.com/*',
  'https://chat.openai.com/*',
  'https://gemini.google.com/*',
  'https://claude.ai/*',
];

async function reloadAiTabs() {
  const tabs = await chrome.tabs.query({ url: AI_TAB_PATTERNS });
  for (const tab of tabs) {
    if (tab.id) {
      chrome.tabs.reload(tab.id).catch(() => {});
    }
  }
}

// Sync on extension install / update
chrome.runtime.onInstalled.addListener((details) => {
  getClientToken().catch(console.error);
  syncMemories().catch(err => console.warn('[CMA] Memory sync skipped:', err.message));

  if (details.reason === 'update') {
    reloadAiTabs().catch(console.error);
  }
});

// Periodic sync + keep-alive ping. MV3 service workers are suspended when idle,
// so chrome.alarms is used instead of setInterval.
chrome.alarms.create('syncMemories', { periodInMinutes: 5 });
chrome.alarms.create('keepAlive', { periodInMinutes: 10 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'syncMemories') {
    syncMemories().catch(err => console.warn('[CMA] Memory sync skipped:', err.message));
  }
  if (alarm.name === 'keepAlive') {
    // Keeps a free-tier hosted backend (e.g. Render) awake; harmless locally.
    apiFetch('/health', { timeoutMs: 10000 }).catch(() => {});
  }
});

if (chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(() => {
    apiFetch('/health', { timeoutMs: 10000 }).catch(() => {});
  });
}
