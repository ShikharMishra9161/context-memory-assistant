btn.addEventListener('click', async () => {
  btn.innerHTML = '⏳ Searching...';
  btn.disabled = true;

  try {
    // Use what the user already typed as the search query
    const currentQuery =
      window.CMA.getEditorText(PRIMARY_SELECTOR);

    // Get only relevant memories
    const memories =
      await window.CMA.getRelevantMemories(
        currentQuery,
        5
      );

    const context =
      window.CMA.buildContextBlock(memories);

    btn.disabled = false;

    if (!context) {
      window.CMA.flashButton(
        btn,
        '⚠️ No memories found'
      );
      return;
    }

    const ed = getEditor();

    if (!ed) return;

    ed.focus();

    const existingText = ed.innerText.trim();

    document.execCommand(
      'selectAll',
      false,
      null
    );

    document.execCommand(
      'insertText',
      false,
      context +
        (existingText
          ? '\n\n' + existingText
          : '')
    );

    ed.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText'
      })
    );

    window.CMA.flashButton(
      btn,
      `✅ Injected ${memories.length} memories`
    );

  } catch (error) {
    console.error(error);

    btn.disabled = false;

    window.CMA.flashButton(
      btn,
      '❌ Search failed'
    );
  }
});