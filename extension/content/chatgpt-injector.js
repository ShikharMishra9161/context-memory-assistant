(async function () {
  let injected = false;

  // Get selector from service worker
  const { selectors } = await chrome.runtime.sendMessage({
    type: 'GET_SELECTORS'
  });

  const SELECTOR = selectors.chatgpt;

  window.CMA.waitForElement(SELECTOR, () => {
    if (injected) return;
    injected = true;

    const btn = window.CMA.createInjectButton();
    document.body.appendChild(btn);

    btn.addEventListener('click', async () => {
      const memories = await window.CMA.getMemories();
      const context = window.CMA.buildContextBlock(memories);

      if (!context) {
        window.CMA.flashButton(btn, '⚠️ No memories saved');
        return;
      }

      // Find ChatGPT input
      const editable = document.querySelector(SELECTOR);
      if (!editable) return;

      editable.focus();

      // Preserve existing prompt text
      const existing = editable.innerText.trim();

      editable.innerText =
        context + (existing ? '\n\n' + existing : '');

      // Notify React that content changed
      editable.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          cancelable: true
        })
      );

      // Move cursor to end
      const range = document.createRange();
      const selection = window.getSelection();

      range.selectNodeContents(editable);
      range.collapse(false);

      selection.removeAllRanges();
      selection.addRange(range);

      window.CMA.flashButton(btn, '✅ Injected!');
    });
  });
})();