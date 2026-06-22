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

  const PRIMARY_SELECTOR = selectors.claude;

  function getEditor() {
    return document.querySelector(PRIMARY_SELECTOR);
  }

  function init() {
    window.CMA.waitForElement(PRIMARY_SELECTOR, () => {
      if (injected) return;
      injected = true;

      const btn = window.CMA.createInjectButton();
      document.body.appendChild(btn);

      window.CMA.wrapInjectClick(btn, async () => {
        btn.innerHTML = '⏳ Searching...';
        btn.disabled = true;

        try {
          const currentQuery = window.CMA.getEditorText(PRIMARY_SELECTOR);
          const memories = await window.CMA.getRelevantMemories(currentQuery, 5);
          const context = window.CMA.buildContextBlock(memories);

          if (!context) {
            window.CMA.flashButton(btn, '⚠️ No memories found');
            return;
          }

          const ed = getEditor();
          if (!ed) {
            window.CMA.flashButton(btn, '⚠️ Editor not found');
            return;
          }

          ed.focus();

          const existingText = ed.innerText.trim();

          document.execCommand('selectAll', false, null);
          document.execCommand(
            'insertText',
            false,
            context + (existingText ? '\n\n' + existingText : '')
          );

          ed.dispatchEvent(
            new InputEvent('input', {
              bubbles: true,
              inputType: 'insertText',
            })
          );

          window.CMA.flashButton(btn, `✅ Injected ${memories.length} memories`);
        } finally {
          if (window.CMA.isExtensionValid()) {
            btn.disabled = false;
          }
        }
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
