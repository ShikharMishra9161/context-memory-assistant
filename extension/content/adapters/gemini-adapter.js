// Gemini (gemini.google.com) extraction adapter. DOM knowledge only; see extract-core.js.
(function () {
  if (!window.CMAExtract || window.CMAExtract._adapters.some(a => a.id === 'gemini')) return;
  const { outermostInOrder } = window.CMAExtract;

  window.CMAExtract.registerAdapter({
    id: 'gemini',
    name: 'Gemini',
    version: 1,
    composerSelector: 'div.ql-editor[contenteditable="true"], rich-textarea [contenteditable="true"]',
    newChatUrl: 'https://gemini.google.com/app',
    ignoreSelectors: ['.response-footer', 'message-actions', '.cdk-visually-hidden', 'sources-carousel', '.thoughts-header'],

    matches: loc => loc.hostname === 'gemini.google.com',
    getConversationId: () =>
      (location.pathname.match(/\/app\/([\w-]+)/) || location.pathname.match(/\/gem\/[\w-]+\/([\w-]+)/) || [])[1] || '',
    getTitle: () => {
      const selected = document.querySelector('.conversation.selected .conversation-title, [aria-current="page"] .conversation-title');
      return (selected?.textContent || document.title.replace(/\s*[-|]\s*Gemini\s*$/i, '')).trim();
    },

    findMessages(doc) {
      const entries = [
        ...Array.from(doc.querySelectorAll('user-query')).map(el => ({ el, role: 'user' })),
        ...Array.from(doc.querySelectorAll('model-response')).map(el => ({ el, role: 'assistant' })),
      ];
      if (entries.length) return outermostInOrder(entries);
      // Fallback for builds without the custom elements.
      return outermostInOrder([
        ...Array.from(doc.querySelectorAll('.user-query-container, [data-test-id="user-query"]')).map(el => ({ el, role: 'user' })),
        ...Array.from(doc.querySelectorAll('.model-response-text, [data-test-id="model-response"]')).map(el => ({ el, role: 'assistant' })),
      ]);
    },

    getContent(el, role) {
      if (role === 'user') return el.querySelector('.query-text, user-query-content') || el;
      return el.querySelector('message-content, .markdown, .model-response-text') || el;
    },

    isStreaming: () => Boolean(document.querySelector('button[aria-label*="Stop" i], model-response [aria-busy="true"]')),
    getScrollContainer: () => document.querySelector('infinite-scroller, [data-test-id="chat-history-container"]'),
  });
})();
