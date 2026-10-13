// Claude (claude.ai) extraction adapter. DOM knowledge only; see extract-core.js.
(function () {
  if (!window.CMAExtract || window.CMAExtract._adapters.some(a => a.id === 'claude')) return;
  const { outermostInOrder } = window.CMAExtract;

  window.CMAExtract.registerAdapter({
    id: 'claude',
    name: 'Claude',
    version: 1,
    composerSelector: 'div[contenteditable="true"].ProseMirror',
    newChatUrl: 'https://claude.ai/new',

    matches: loc => /(^|\.)claude\.ai$/.test(loc.hostname),
    getConversationId: () => (location.pathname.match(/\/chat\/([\w-]+)/) || [])[1] || '',
    getTitle: () => document.title.replace(/\s*[-|]\s*Claude\s*$/i, '').trim(),

    findMessages(doc) {
      const users = Array.from(doc.querySelectorAll('[data-testid="user-message"]'))
        .map(el => ({ el, role: 'user' }));
      let assistants = Array.from(doc.querySelectorAll('.font-claude-response, .font-claude-message'))
        .map(el => ({ el, role: 'assistant' }));

      // Fallback: streaming containers wrap assistant replies.
      if (!assistants.length) {
        assistants = Array.from(doc.querySelectorAll('[data-is-streaming]'))
          .filter(el => !el.querySelector('[data-testid="user-message"]'))
          .map(el => ({ el, role: 'assistant' }));
      }
      return outermostInOrder(users.concat(assistants));
    },

    isStreaming: () => Boolean(document.querySelector('[data-is-streaming="true"]')),
  });
})();
