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

  // 2026 layout: turns are div[data-turn-key]; each message block inside carries a
  // search key ending in ":user" / ":assistant" and the message id(s).
  const UNIT_SELECTOR = '[data-content-search-unit-key], [data-chatgpt-search-unit-key]';

  function roleFromUnitKey(el) {
    const key = el.getAttribute('data-content-search-unit-key') || el.getAttribute('data-chatgpt-search-unit-key') || '';
    const m = /:(user|assistant)$/i.exec(key);
    return m ? m[1].toLowerCase() : '';
  }

  function inferRole(el) {
    if (el.querySelector('[data-markdown-text-style="assistant-message"], .markdown')) return 'assistant';
    if (el.querySelector('[data-markdown-text-style="user-message"], .whitespace-pre-wrap')) return 'user';
    return roleFromTurn(el);
  }

  function messageId(el) {
    const ids = (el.getAttribute('data-chatgpt-search-message-ids') || '').trim();
    if (ids) return ids.split(/\s+/)[0];
    const sel = el.querySelector('[data-chatgpt-selection-message-id]');
    return (sel && sel.getAttribute('data-chatgpt-selection-message-id')) || el.getAttribute('data-turn-key') || '';
  }

  function findModernMessages(doc) {
    const units = Array.from(doc.querySelectorAll(UNIT_SELECTOR))
      .map(el => ({ el, role: roleFromUnitKey(el) || inferRole(el), id: messageId(el) }));
    // Turns without search units (e.g. user turns, if they are not keyed) are taken whole.
    const bareTurns = Array.from(doc.querySelectorAll('[data-turn-key]'))
      .filter(t => !t.querySelector(UNIT_SELECTOR) && !t.closest(UNIT_SELECTOR))
      .map(el => ({ el, role: inferRole(el), id: messageId(el) }));
    return outermostInOrder(units.concat(bareTurns));
  }

  const isLabel = el => !el.closest('button') && !el.querySelector('button') &&
    /^[\w+#.-]{1,20}$/.test((el.textContent || '').trim());

  // Header element naming a code block's language: inside <pre> (older layout) or beside it
  // inside the div[data-code-block] wrapper (2026 layout). Highlight spans inside <code> never count.
  function codeBlockLabel(pre) {
    const code = pre.querySelector('code');
    const inPre = Array.from(pre.querySelectorAll('div, span'))
      .find(el => !el.contains(code) && !(code && code.contains(el)) && isLabel(el));
    if (inPre) return inPre;
    const wrapper = pre.closest('[data-code-block]');
    for (const scope of [wrapper, wrapper && wrapper.parentElement]) {
      if (!scope) continue;
      const label = Array.from(scope.querySelectorAll('div, span'))
        .find(el => !el.contains(pre) && !pre.contains(el) && isLabel(el));
      if (label) return label;
    }
    return null;
  }

  window.CMAExtract.registerAdapter({
    id: 'chatgpt',
    name: 'ChatGPT',
    version: 2,
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

      const modern = findModernMessages(doc);
      if (modern.length) return modern;

      // Fallback: conversation turns without role attributes.
      return Array.from(doc.querySelectorAll('[data-testid^="conversation-turn-"]'))
        .map(el => ({ el, role: roleFromTurn(el), id: el.getAttribute('data-testid') || '' }));
    },

    getContent(el, role) {
      // A label outside <pre> would otherwise be extracted as a stray line above the code.
      el.querySelectorAll('[data-code-block] pre').forEach(pre => {
        const label = codeBlockLabel(pre);
        if (label && !pre.contains(label)) label.setAttribute('data-cma-ignore', '');
      });
      if (role === 'assistant') {
        const roots = el.querySelectorAll('.markdown, [data-markdown-text-style="assistant-message"]');
        return roots.length === 1 ? roots[0] : el;
      }
      return el.querySelector('.whitespace-pre-wrap, [data-markdown-text-style="user-message"]') || el;
    },

    codeLanguage(pre) {
      const code = pre.querySelector('code');
      const cls = code && String(code.className).match(/language-([\w+#.-]+)/);
      if (cls) return cls[1].toLowerCase();
      const label = codeBlockLabel(pre);
      return label ? label.textContent.trim().toLowerCase() : '';
    },

    isStreaming: () => Boolean(document.querySelector('[data-testid="stop-button"], .result-streaming, button[aria-label="Stop streaming"]')),
  });
})();
