const API_BASE = 'http://localhost:4000';

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
      .catch(error => {
        console.error('Sync failed:', error);
        reply({ error: error.message });
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
      .then(mem => {
        syncMemories();

        reply({
          success: true,
          memory: mem
        });
      })
      .catch(error => {
        console.error('Save failed:', error);

        reply({
          success: false,
          error: error.message
        });
      });

    return true;
  }

  // Delete memory
  if (msg.type === 'DELETE_MEMORY') {
    fetch(`${API_BASE}/memory/${msg.id}`, {
      method: 'DELETE'
    })
      .then(() => {
        syncMemories();

        reply({
          success: true
        });
      })
      .catch(error => {
        console.error('Delete failed:', error);

        reply({
          success: false,
          error: error.message
        });
      });

    return true;
  }
});

// Sync on extension install
chrome.runtime.onInstalled.addListener(() => {
  syncMemories().catch(console.error);
});

// Sync every 5 minutes
setInterval(() => {
  syncMemories().catch(console.error);
}, 5 * 60 * 1000);