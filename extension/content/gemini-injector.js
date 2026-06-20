(async function () {
  let injected = false;

  // Get selector from service worker
  const { selectors } = await chrome.runtime.sendMessage({
    type: 'GET_SELECTORS'
  });

  const SELECTOR = selectors.gemini;

  function init() {
    window.CMA.waitForElement(SELECTOR, () => {
      if (injected) return;
      injected = true;

      const btn = window.CMA.createInjectButton();

      // Avoid overlapping Gemini UI
      btn.style.bottom = '120px';

      document.body.appendChild(btn);

      btn.addEventListener('click', async () => {
        const memories = await window.CMA.getMemories();
        const context = window.CMA.buildContextBlock(memories);

        if (!context) {
          window.CMA.flashButton(btn, '⚠️ No memories saved');
          return;
        }

        const editor = document.querySelector(SELECTOR);

        if (!editor) return;

        editor.focus();

        // Capture existing prompt
        const existing = editor.innerText.trim();

        // Select all current content
        document.execCommand('selectAll', false, null);

        // Insert context + existing text
        document.execCommand(
          'insertText',
          false,
          context + (existing ? '\n\n' + existing : '')
        );

        // Notify Quill editor
        editor.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            inputType: 'insertText'
          })
        );

        window.CMA.flashButton(btn, '✅ Injected!');
      });
    });
  }

  // Initial load
  init();

  // Gemini SPA navigation handling
  let lastUrl = location.href;

  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;

      const existingBtn = document.getElementById('cma-inject-btn');

      if (existingBtn) {
        existingBtn.remove();
      }

      injected = false;

      setTimeout(init, 500);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
})();