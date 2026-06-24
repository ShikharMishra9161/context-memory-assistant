const IS_DEV = false; // flip to true during local dev
const API_BASE = IS_DEV
  ? 'http://localhost:3001'
  : 'https://context-memory-api.onrender.com';


 
// Selector config — update here if sites change their DOM
const SELECTORS = {
  chatgpt: '#prompt-textarea',
  gemini: 'div.ql-editor[contenteditable="true"]',
  claude: 'div[contenteditable="true"].ProseMirror'
};

// Fetch memories from backend, cache in chrome.storage
async function syncMemories() {
  const res = await fetch(`${API_BASE}/memory`);
  const memories = await res.json();

  await chrome.storage.local.set({
    memories,
    lastSync: Date.now()
  });

  return memories;
}

// Listen for messages from content scripts / popup
chrome.runtime.onMessage.addListener((msg, sender, reply) => {

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

  // Semantic memory search
  if (msg.type === 'SEARCH_MEMORIES') {
    fetch(`${API_BASE}/memory/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: msg.query,
        topK: msg.topK || 5
      })
    })
      .then(r => r.json())
      .then(memories => {
        reply({ memories });
      })
      .catch(error => {
        console.error('Search failed:', error);

        // Fallback to cached memories
        chrome.storage.local.get(['memories'], (data) => {
          reply({
            memories: data.memories || []
          });
        });
      });

    return true;
  }

  // Force sync from backend
  if (msg.type === 'SYNC_MEMORIES') {
    syncMemories()
      .then(memories => reply({ memories }))
      .catch(async (error) => {
        console.error('Sync failed:', error);
        const data = await chrome.storage.local.get(['memories']);
        reply({ memories: data.memories || [], error: error.message });
      });

    return true;
  }

  // Save memory
  if (msg.type === 'SAVE_MEMORY') {
    fetch(`${API_BASE}/memory`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(msg.payload)
    })
      .then(r => r.json())
      .then(async (mem) => {
        const memories = await syncMemories();
        reply({ success: true, memory: mem, memories });
      })
      .catch(error => {
        console.error('Save failed:', error);
        reply({ success: false, error: error.message });
      });

    return true;
  }

  // Update memory
  if (msg.type === 'UPDATE_MEMORY') {
    fetch(`${API_BASE}/memory/${msg.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(msg.payload)
    })
      .then(r => r.json())
      .then(async (mem) => {
        const memories = await syncMemories();
        reply({ success: true, memory: mem, memories });
      })
      .catch(error => {
        console.error('Update failed:', error);
        reply({ success: false, error: error.message });
      });

    return true;
  }

  // Delete memory
  if (msg.type === 'DELETE_MEMORY') {
    fetch(`${API_BASE}/memory/${msg.id}`, {
      method: 'DELETE'
    })
      .then(async () => {
        const memories = await syncMemories();
        reply({ success: true, memories });
      })
      .catch(error => {
        console.error('Delete failed:', error);
        reply({ success: false, error: error.message });
      });

    return true;
  }
});

// Reload AI tabs after extension update so content scripts reconnect
const AI_TAB_PATTERNS = [
  'https://chatgpt.com/*',
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
  syncMemories().catch(console.error);

  if (details.reason === 'update') {
    reloadAiTabs().catch(console.error);
  }
});

// Sync every 5 minutes
setInterval(() => {
  syncMemories().catch(console.error);
}, 5 * 60 * 1000);

 // --------------------------------------------------
// Keep Render backend awake (free tier)
// --------------------------------------------------

function keepAlive() {
  fetch(`${API_BASE}/health`)
    .then(() => console.log('KeepAlive ping sent'))
    .catch(err => console.warn('KeepAlive failed:', err));
}

// Create alarm every 10 minutes
chrome.alarms.create('keepAlive', {
  periodInMinutes: 10
});

// Listen for alarm
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    keepAlive();
  }
});

// Ping once when extension/browser starts
if (chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(() => {
    keepAlive();
  });
}