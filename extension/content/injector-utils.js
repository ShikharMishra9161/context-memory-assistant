window.CMA = {
  _contextValid: true,
  _buttons: new Set(),
  _invalidatedHandled: false,

  buildContextBlock(memories) {
    if (!memories?.length) return '';

    let block = `\n\n--- MY CONTEXT (auto-injected by Context Memory Assistant) ---\n\n`;

    memories.forEach((m, i) => {
      block += `${i + 1}. [${m.category.toUpperCase()}]\n`;
      block += `   Title: ${m.title}\n`;
      block += `   Content: ${m.content}\n\n`;
    });

    block += `--- END CONTEXT ---\n\n`;

    return block;
  },

  isExtensionValid() {
    try {
      return Boolean(chrome?.runtime?.id);
    } catch {
      return false;
    }
  },

  isContextInvalidatedError(err) {
    const msg = String(err?.message || err || '');
    return (
      msg.includes('Extension context invalidated') ||
      msg.includes('Receiving end does not exist') ||
      msg.includes('Could not establish connection') ||
      msg === 'EXTENSION_CONTEXT_INVALIDATED'
    );
  },

  safeSendMessage(message) {
    return new Promise((resolve, reject) => {
      if (!this.isExtensionValid()) {
        reject(new Error('EXTENSION_CONTEXT_INVALIDATED'));
        return;
      }

      try {
        chrome.runtime.sendMessage(message, (response) => {
          const lastError = chrome.runtime.lastError;

          if (lastError) {
            const err = new Error(lastError.message || 'Extension message failed');
            if (this.isContextInvalidatedError(err)) {
              reject(new Error('EXTENSION_CONTEXT_INVALIDATED'));
            } else {
              reject(err);
            }
            return;
          }

          resolve(response ?? {});
        });
      } catch (err) {
        if (this.isContextInvalidatedError(err)) {
          reject(new Error('EXTENSION_CONTEXT_INVALIDATED'));
        } else {
          reject(err);
        }
      }
    });
  },

  registerInjectButton(btn) {
    this._buttons.add(btn);
    if (!this._contextValid) {
      this.markButtonForReload(btn);
    }
  },

  markButtonForReload(btn) {
    if (btn.dataset.cmaReloading) return;
    btn.dataset.cmaReloading = '1';

    const replacement = btn.cloneNode(false);
    replacement.id = btn.id;
    replacement.dataset.cmaReloading = '1';
    replacement.innerHTML = '↻ Reload to reconnect';
    replacement.title = 'Extension was updated — click to reload the page';
    replacement.style.cssText = btn.style.cssText;
    replacement.style.background = '#dc2626';

    replacement.addEventListener('click', (e) => {
      e.preventDefault();
      this.recoverByReload();
    });

    btn.replaceWith(replacement);
    this._buttons.delete(btn);
    this._buttons.add(replacement);
  },

  canAutoRecover() {
    try {
      const last = Number(sessionStorage.getItem('cma-recovering') || 0);
      return !last || Date.now() - last > 15000;
    } catch {
      return true;
    }
  },

  handleContextInvalidated({ button, autoReload = false } = {}) {
    if (this._invalidatedHandled && !button) return;
    this._contextValid = false;
    this._invalidatedHandled = true;

    console.warn('[CMA] Extension context invalidated — reload the page to reconnect.');

    if (button) {
      this.markButtonForReload(button);
    } else {
      this._buttons.forEach((btn) => {
        if (document.body.contains(btn)) {
          this.markButtonForReload(btn);
        }
      });
    }

    if (autoReload && this.canAutoRecover()) {
      this.recoverByReload();
    }
  },

  recoverByReload() {
    if (this._recoveryPending) return;

    try {
      sessionStorage.setItem('cma-recovering', String(Date.now()));
    } catch {
      // ignore
    }

    this._recoveryPending = true;
    location.reload();
  },

  async getSelectors() {
    const { selectors } = await this.safeSendMessage({ type: 'GET_SELECTORS' });
    return selectors || {};
  },

  async getMemories() {
    try {
      const { memories } = await this.safeSendMessage({ type: 'GET_MEMORIES' });
      return memories || [];
    } catch (err) {
      if (this.isContextInvalidatedError(err)) {
        this.handleContextInvalidated();
        return [];
      }
      console.error('[CMA] getMemories failed:', err);
      return [];
    }
  },

  async getRelevantMemories(query = '', topK = 5) {
    if (!query.trim()) {
      return this.getMemories();
    }

    try {
      const { memories } = await this.safeSendMessage({
        type: 'SEARCH_MEMORIES',
        query: query.trim(),
        topK,
      });
      return memories || [];
    } catch (err) {
      if (this.isContextInvalidatedError(err)) {
        this.handleContextInvalidated();
        return [];
      }

      console.error('[CMA] Memory search failed:', err);
      return this.getMemories();
    }
  },

  getEditorText(selector) {
    const el = document.querySelector(selector);
    if (!el) return '';

    return (el.innerText || el.value || '').trim();
  },

  createInjectButton(label = '🧠 Inject Context') {
    const btn = document.createElement('button');

    btn.id = 'cma-inject-btn';
    btn.innerHTML = label;
    btn.dataset.cmaLabel = label;

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
      if (this._contextValid) btn.style.background = '#4f46e5';
    };

    btn.onmouseleave = () => {
      btn.style.background = this._contextValid ? '#6366f1' : '#dc2626';
    };

    btn.onmousedown = () => {
      btn.style.transform = 'scale(0.96)';
    };

    btn.onmouseup = () => {
      btn.style.transform = 'scale(1)';
    };

    this.registerInjectButton(btn);
    return btn;
  },

  wrapInjectClick(btn, handler) {
    btn.addEventListener('click', async () => {
      if (!this.isExtensionValid()) {
        this.handleContextInvalidated({ button: btn });
        return;
      }

      try {
        await handler();
      } catch (err) {
        console.error('[CMA] Inject handler failed:', err);

        if (this.isContextInvalidatedError(err)) {
          this.handleContextInvalidated({ button: btn });
          return;
        }

        this.flashButton(btn, '❌ Injection failed');
      }
    });
  },

  flashButton(btn, msg, resetLabel) {
    const label = resetLabel || btn.dataset.cmaLabel || '🧠 Inject Context';
    btn.innerHTML = msg;

    setTimeout(() => {
      if (this._contextValid && document.body.contains(btn)) {
        btn.innerHTML = label;
      }
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
      subtree: true,
    });

    const el = document.querySelector(selector);
    if (el) {
      observer.disconnect();
      callback(el);
    }
  },

  startContextWatch() {
    if (this._watchStarted) return;
    this._watchStarted = true;

    setInterval(() => {
      if (this._contextValid && !this.isExtensionValid()) {
        this.handleContextInvalidated();
      }
    }, 3000);
  },
};

// Auto-reload after extension update triggered recovery
try {
  if (sessionStorage.getItem('cma-recovering')) {
    sessionStorage.removeItem('cma-recovering');
    console.info('[CMA] Page reloaded — extension context restored.');
  }
} catch {
  // ignore
}

window.CMA.startContextWatch();
