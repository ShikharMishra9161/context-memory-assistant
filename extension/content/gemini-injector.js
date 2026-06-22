(async function () {
  let injected = false;

  let selectors;
  try {
    selectors = await window.CMA.getSelectors();
  } catch (err) {
    console.error('[CMA] Failed to load selectors:', err);
    if (window.CMA.isContextInvalidatedError(err)) {
      window.CMA.handleContextInvalidated({ autoReload: true });
    }
    return;
  }

  const SELECTOR = selectors.gemini;

  function init() {
    window.CMA.waitForElement(SELECTOR, () => {
      if (injected) return;
      injected = true;

      const btn = window.CMA.createInjectButton();
      btn.style.bottom = '120px';
      document.body.appendChild(btn);

      window.CMA.wrapInjectClick(btn, async () => {
        const memories = await window.CMA.getMemories();
        const context = window.CMA.buildContextBlock(memories);

        if (!context) {
          window.CMA.flashButton(btn, '⚠️ No memories saved');
          return;
        }

        const editor = document.querySelector(SELECTOR);
        if (!editor) return;

        editor.focus();

        const existing = editor.innerText.trim();

        document.execCommand('selectAll', false, null);
        document.execCommand(
          'insertText',
          false,
          context + (existing ? '\n\n' + existing : '')
        );

        editor.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            inputType: 'insertText',
          })
        );

        window.CMA.flashButton(btn, `✅ Injected ${memories.length} memories`);
      });
    });
  }

  init();

  let lastUrl = location.href;

  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;

      const existingBtn = document.getElementById('cma-inject-btn');
      if (existingBtn) {
        window.CMA._buttons.delete(existingBtn);
        existingBtn.remove();
      }

      injected = false;
      setTimeout(init, 500);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
})();
