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

  const SELECTOR = selectors.chatgpt;

  window.CMA.waitForElement(SELECTOR, () => {
    if (injected) return;
    injected = true;

    const btn = window.CMA.createInjectButton();
    document.body.appendChild(btn);

    window.CMA.wrapInjectClick(btn, async () => {
      const memories = await window.CMA.getMemories();
      const context = window.CMA.buildContextBlock(memories);

      if (!context) {
        window.CMA.flashButton(btn, '⚠️ No memories saved');
        return;
      }

      const editable = document.querySelector(SELECTOR);

      if (!editable) {
        window.CMA.flashButton(btn, '⚠️ Editor not found');
        return;
      }

      editable.focus();

      const existing = editable.innerText.trim();
      const finalText = context + (existing ? '\n\n' + existing : '');

      editable.textContent = finalText;

      editable.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
        })
      );

      const range = document.createRange();
      const selection = window.getSelection();

      range.selectNodeContents(editable);
      range.collapse(false);

      selection.removeAllRanges();
      selection.addRange(range);

      window.CMA.flashButton(btn, `✅ Injected ${memories.length} memories`);
    });
  });
})();
