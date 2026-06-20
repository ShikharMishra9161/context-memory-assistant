window.CMA = {
  buildContextBlock(memories) {
    if (!memories?.length) return '';

    const grouped = memories.reduce((acc, m) => {
      if (!acc[m.category]) acc[m.category] = [];
      acc[m.category].push(`- ${m.title}: ${m.content}`);
      return acc;
    }, {});

    let block = `\n\n--- MY CONTEXT (auto-injected by Context Memory Assistant) ---\n`;

    for (const [cat, items] of Object.entries(grouped)) {
      block += `\n[${cat.toUpperCase()}]\n${items.join('\n')}\n`;
    }

    block += `--- END CONTEXT ---\n\n`;

    return block;
  },

  async getMemories() {
    const { memories } = await chrome.runtime.sendMessage({
      type: 'GET_MEMORIES'
    });

    return memories || [];
  },

  /**
   * Semantic search support
   * Returns top relevant memories for current prompt
   */
  async getRelevantMemories(query = '', topK = 5) {
    if (!query.trim()) {
      return this.getMemories();
    }

    try {
      const { memories } = await chrome.runtime.sendMessage({
        type: 'SEARCH_MEMORIES',
        query: query.trim(),
        topK
      });

      return memories || [];
    } catch (err) {
      console.error('Memory search failed:', err);

      // fallback to all memories
      return this.getMemories();
    }
  },

  /**
   * Read current text from editor
   * Used as search query
   */
  getEditorText(selector) {
    const el = document.querySelector(selector);

    if (!el) return '';

    return (
      el.innerText ||
      el.value ||
      ''
    ).trim();
  },

  createInjectButton(label = '🧠 Inject Context') {
    const btn = document.createElement('button');

    btn.id = 'cma-inject-btn';
    btn.innerHTML = label;

    btn.style.cssText = `
      position: fixed;
      bottom: 100px;
      right: 20px;
      background: #6366f1;
      color: white;
      border: none;
      border-radius: 8px;
      padding: 8px 14px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      z-index: 2147483647;
      box-shadow: 0 2px 12px rgba(99,102,241,0.4);
      transition: background 0.2s, transform 0.1s;
      font-family: system-ui, sans-serif;
    `;

    btn.onmouseenter = () => {
      btn.style.background = '#4f46e5';
    };

    btn.onmouseleave = () => {
      btn.style.background = '#6366f1';
    };

    btn.onmousedown = () => {
      btn.style.transform = 'scale(0.96)';
    };

    btn.onmouseup = () => {
      btn.style.transform = 'scale(1)';
    };

    return btn;
  },

  flashButton(btn, msg, resetLabel = '🧠 Inject Context') {
    btn.innerHTML = msg;

    setTimeout(() => {
      btn.innerHTML = resetLabel;
    }, 2000);
  },

  waitForElement(selector, callback, timeout = 15000) {
    const start = Date.now();

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);

      if (el) {
        observer.disconnect();
        callback(el);
        return;
      }

      if (Date.now() - start > timeout) {
        observer.disconnect();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Check immediately
    const el = document.querySelector(selector);

    if (el) {
      observer.disconnect();
      callback(el);
    }
  }
};