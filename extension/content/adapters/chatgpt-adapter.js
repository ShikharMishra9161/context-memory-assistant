// ChatGPT (chatgpt.com) extraction adapter. DOM knowledge only; see extract-core.js.
(function () {
  if (!window.CMAExtract || window.CMAExtract._adapters.some(a => a.id === 'chatgpt')) return;
  const { outermostInOrder } = window.CMAExtract;

  function roleFromTurn(turn) {
    // Each turn carries a visually hidden heading such as "You said:" / "ChatGPT said:".
    const label = (turn.querySelector('h5, h6, .sr-only')?.textContent || '').toLowerCase();
    if (label.includes('you said')) return 'user';
    if (label.includes('said')) return 'assistant';
    return 'unknown';
  }

  window.CMAExtract.registerAdapter({
    id: 'chatgpt',
    name: 'ChatGPT',
    version: 1,
    composerSelector: '#prompt-textarea',
    newChatUrl: 'https://chatgpt.com/',
    ignoreSelectors: ['[data-testid$="-turn-action-button"]'],

    matches: loc => /(^|\.)chatgpt\.com$|(^|\.)chat\.openai\.com$/.test(loc.hostname),
    getConversationId: () => (location.pathname.match(/\/c\/([\w-]+)/) || [])[1] || '',
    getTitle: () => document.title.replace(/\s*[-|]\s*ChatGPT\s*$/i, '').trim(),

    findMessages(doc) {
      // Primary: every message node is tagged with its author role and a stable id.
      const tagged = Array.from(doc.querySelectorAll('[data-message-author-role]')).map(el => ({
        el,
        role: el.getAttribute('data-message-author-role'),
        id: el.getAttribute('data-message-id') || '',
      }));
      if (tagged.length) return outermostInOrder(tagged).filter(e => e.role !== 'system' && e.role !== 'tool');

      // Fallback: conversation turns without role attributes.
      return Array.from(doc.querySelectorAll('[data-testid^="conversation-turn-"]'))
        .map(el => ({ el, role: roleFromTurn(el), id: el.getAttribute('data-testid') || '' }));
    },

    getContent(el, role) {
      if (role === 'assistant') return el.querySelector('.markdown') || el;
      return el.querySelector('.whitespace-pre-wrap') || el;
    },

    // ChatGPT renders the language label in a header inside <pre>, above the <code>.
    codeLanguage(pre) {
      const code = pre.querySelector('code');
      const cls = code && String(code.className).match(/language-([\w+#.-]+)/);
      if (cls) return cls[1].toLowerCase();
      const header = Array.from(pre.querySelectorAll('div, span'))
        .find(el => !el.contains(code) && /^[\w+#.-]{1,20}$/.test((el.textContent || '').trim()));
      return header ? header.textContent.trim().toLowerCase() : '';
    },

    isStreaming: () => Boolean(document.querySelector('[data-testid="stop-button"], .result-streaming, button[aria-label="Stop streaming"]')),
  });
})();
