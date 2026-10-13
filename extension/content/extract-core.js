// Platform-agnostic conversation extraction. Platform adapters register
// themselves via CMAExtract.registerAdapter() and only supply DOM knowledge;
// this file handles DOM→Markdown, waiting for dynamic rendering, loading
// earlier history by scrolling, de-duplication across snapshots and the
// signals used to flag a partial extraction.
(function () {
  if (window.CMAExtract) return; // already injected (manifest + scripting fallback)

  const adapters = [];
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ---------------------------------------------------------------------------
  // DOM → Markdown
  // ---------------------------------------------------------------------------

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'BUTTON', 'TEMPLATE', 'IFRAME', 'CANVAS',
    'VIDEO', 'AUDIO', 'IMG', 'INPUT', 'TEXTAREA', 'SELECT', 'FORM', 'MAT-ICON', 'PICTURE',
  ]);
  const BLOCK_TAGS = new Set([
    'P', 'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'NAV', 'FIGURE',
    'FIGCAPTION', 'DETAILS', 'SUMMARY', 'DL', 'DT', 'DD', 'HR',
  ]);
  const DEFAULT_IGNORE = [
    '[aria-hidden="true"]', '.sr-only', '[data-cma-ignore]', '#cma-inject-btn',
    '.katex-html', // KaTeX visual layer; the MathML annotation is used instead
  ];

  function codeLanguage(pre, code) {
    for (const el of [code, pre]) {
      if (!el) continue;
      const m = (el.className && String(el.className).match(/(?:language|lang)-([\w+#.-]+)/)) ||
        String(el.getAttribute?.('data-language') || '').match(/^([\w+#.-]+)$/);
      if (m) return m[1].toLowerCase();
    }
    return '';
  }

  function makeFence(code, lang) {
    const longest = Math.max(2, ...(code.match(/`+/g) || []).map(s => s.length));
    const ticks = '`'.repeat(longest + 1);
    return `${ticks}${lang}\n${code.replace(/\n+$/, '')}\n${ticks}`;
  }

  /**
   * Converts a message element to Markdown, preserving code blocks, lists,
   * headings, tables and inline code. Code is kept byte-for-byte.
   */
  function domToMarkdown(root, opts = {}) {
    const ignore = [...DEFAULT_IGNORE, ...(opts.ignoreSelectors || [])].join(',');
    const codeLanguageHook = opts.codeLanguage;
    const codes = [];

    function isIgnored(el) {
      if (SKIP_TAGS.has(el.tagName)) return true;
      try { return el.matches(ignore); } catch { return false; }
    }

    function walk(node, ctx) {
      if (node.nodeType === 3) {
        return ctx.pre ? node.nodeValue : node.nodeValue.replace(/\s+/g, ' ');
      }
      if (node.nodeType !== 1) return '';
      const el = node;
      const tag = el.tagName;

      if (el.classList?.contains('katex')) {
        const ann = el.querySelector('annotation[encoding="application/x-tex"]');
        if (ann) return `$${ann.textContent.trim()}$`;
      }
      if (isIgnored(el)) return '';

      const kids = () => Array.from(el.childNodes).map(n => walk(n, ctx)).join('');

      switch (tag) {
        case 'PRE': {
          const code = el.querySelector('code');
          const lang = (codeLanguageHook && codeLanguageHook(el)) || codeLanguage(el, code);
          const text = (code || el).textContent;
          codes.push(makeFence(text, lang));
          return `\n\n\u0000${codes.length - 1}\u0000\n\n`;
        }
        case 'CODE': {
          const t = el.textContent;
          if (t.includes('\n')) { // block code rendered without <pre>
            codes.push(makeFence(t, codeLanguage(null, el)));
            return `\n\n\u0000${codes.length - 1}\u0000\n\n`;
          }
          return t ? '`' + t.replace(/`/g, '\\`') + '`' : '';
        }
        case 'BR': return '\n';
        case 'HR': return '\n\n---\n\n';
        case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6':
          return `\n\n${'#'.repeat(Number(tag[1]))} ${kids().trim()}\n\n`;
        case 'STRONG': case 'B': { const t = kids(); return t.trim() ? `**${t.trim()}**` : t; }
        case 'EM': case 'I': { const t = kids(); return t.trim() ? `_${t.trim()}_` : t; }
        case 'A': {
          const t = kids().trim();
          const href = el.getAttribute('href') || '';
          return /^https?:/.test(href) && t && t !== href ? `[${t}](${href})` : t;
        }
        case 'BLOCKQUOTE':
          return '\n\n' + kids().trim().split('\n').map(l => `> ${l}`).join('\n') + '\n\n';
        case 'UL': case 'OL': {
          // Nested lists are indented by their parent item's continuation indent.
          let n = Number(el.getAttribute('start')) || 1;
          const items = Array.from(el.children).filter(c => c.tagName === 'LI').map(li => {
            const marker = tag === 'OL' ? `${n++}.` : '-';
            const body = Array.from(li.childNodes).map(c => walk(c, ctx)).join('')
              .replace(/\n{3,}/g, '\n\n').trim();
            return marker + ' ' + body.split('\n').join('\n' + ' '.repeat(marker.length + 1));
          });
          return `\n${items.join('\n')}\n`;
        }
        case 'TABLE': {
          const rows = Array.from(el.querySelectorAll('tr')).map(tr =>
            '| ' + Array.from(tr.children).map(td => walk(td, ctx).replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|')).join(' | ') + ' |');
          if (!rows.length) return '';
          const cols = el.querySelector('tr')?.children.length || 1;
          rows.splice(1, 0, '|' + ' --- |'.repeat(cols));
          return `\n\n${rows.join('\n')}\n\n`;
        }
        default: {
          const t = kids();
          return BLOCK_TAGS.has(tag) || tag === 'LI' ? `\n${t}\n` : t;
        }
      }
    }

    let md = walk(root, { depth: 0 });
    md = md
      .split('\n').map(l => l.replace(/[ \t]+$/, '')).join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return md.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
  }

  // ---------------------------------------------------------------------------
  // Helpers shared by adapters
  // ---------------------------------------------------------------------------

  /** Sorts elements in document order and drops elements nested inside another match. */
  function outermostInOrder(entries) {
    const sorted = entries.slice().sort((a, b) =>
      a.el === b.el ? 0 : a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    const out = [];
    for (const e of sorted) {
      if (out.some(o => o.el === e.el || o.el.contains(e.el))) continue;
      out.push(e);
    }
    return out;
  }

  function findScrollableAncestor(el) {
    let cur = el?.parentElement;
    while (cur && cur !== document.body) {
      const style = getComputedStyle(cur);
      if (/(auto|scroll)/.test(style.overflowY) && cur.scrollHeight > cur.clientHeight + 10) return cur;
      cur = cur.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  function hasCollapsedContent(el) {
    return Array.from(el.querySelectorAll('button, [role="button"]'))
      .some(b => /^(show more|expand|read more|see more)$/i.test((b.textContent || b.getAttribute('aria-label') || '').trim()));
  }

  function hasNonTextContent(el) {
    return Boolean(el.querySelector('img, canvas, video, iframe, [data-testid*="file"], [data-testid*="attachment"]'));
  }

  // ---------------------------------------------------------------------------
  // Snapshots
  // ---------------------------------------------------------------------------

  function snapshot(adapter) {
    let entries;
    try {
      entries = adapter.findMessages(document) || [];
    } catch (err) {
      console.warn('[CMA] adapter.findMessages failed:', err);
      entries = [];
    }
    return entries.map((e, i) => {
      const content = (adapter.getContent && adapter.getContent(e.el, e.role)) || e.el;
      const text = domToMarkdown(content, {
        ignoreSelectors: adapter.ignoreSelectors,
        codeLanguage: adapter.codeLanguage,
      });
      return {
        el: e.el,
        role: e.role,
        nativeId: e.id || '',
        text,
        key: e.id || `${e.role}:${text.length}:${text.slice(0, 120)}:${text.slice(-60)}`,
        collapsed: hasCollapsedContent(e.el),
        nonText: !text && hasNonTextContent(e.el),
        position: i,
      };
    });
  }

  /** Merges an older/newer snapshot into the accumulated ordered list by overlapping keys. */
  function mergeSnapshot(acc, snap) {
    if (!acc.length) return snap.slice();
    const accKeys = new Map(acc.map((m, i) => [m.key, i]));
    const firstOverlap = snap.findIndex(m => accKeys.has(m.key));
    if (firstOverlap === -1) {
      // No overlap: decide order by DOM position of still-connected nodes; default to prepend (older history).
      return snap.concat(acc);
    }
    const out = acc.slice();
    // Items before the overlap are older: insert before the matching item.
    const insertAt = accKeys.get(snap[firstOverlap].key);
    out.splice(insertAt, 0, ...snap.slice(0, firstOverlap).filter(m => !accKeys.has(m.key)));
    // Items after the last overlap are newer: append.
    const keys = new Set(out.map(m => m.key));
    for (const m of snap.slice(firstOverlap)) if (!keys.has(m.key)) { out.push(m); keys.add(m.key); }
    // Keep the freshest text for nodes that re-rendered (e.g. streaming finished).
    const latest = new Map(snap.map(m => [m.key, m]));
    return out.map(m => latest.get(m.key) || m);
  }

  async function waitForStableCount(adapter, { quietMs = 600, maxMs = 4000 } = {}) {
    const start = Date.now();
    let last = -1;
    let stableSince = Date.now();
    while (Date.now() - start < maxMs) {
      const n = (adapter.findMessages(document) || []).length;
      if (n !== last) { last = n; stableSince = Date.now(); }
      else if (Date.now() - stableSince >= quietMs) break;
      await sleep(150);
    }
    return last;
  }

  /**
   * Scrolls the conversation to the top until no more older messages load,
   * collecting snapshots on the way (handles virtualized lists).
   */
  async function loadHistory(adapter, acc, progress, { maxMs = 25000, settleMs = 900 } = {}) {
    const first = (adapter.findMessages(document) || [])[0];
    if (!first) return { acc, incomplete: false };
    const scroller = (adapter.getScrollContainer && adapter.getScrollContainer()) || findScrollableAncestor(first.el);
    if (!scroller) return { acc, incomplete: false };

    const originalTop = scroller.scrollTop;
    const start = Date.now();
    let stableRounds = 0;
    let lastCount = acc.length;
    let lastFirstKey = acc[0]?.key;
    let incomplete = false;

    while (stableRounds < 2) {
      if (Date.now() - start > maxMs) { incomplete = true; break; }
      scroller.scrollTop = 0;
      scroller.dispatchEvent(new Event('scroll'));
      await sleep(settleMs);
      acc = mergeSnapshot(acc, snapshot(adapter));
      progress({ stage: 'loading-history', count: acc.length });
      const atTop = scroller.scrollTop <= 1;
      if (acc.length === lastCount && acc[0]?.key === lastFirstKey && atTop) stableRounds++;
      else stableRounds = 0;
      lastCount = acc.length;
      lastFirstKey = acc[0]?.key;
    }

    // If nodes were unmounted while scrolling up (virtualized list), walk back down collecting them.
    const virtualized = acc.some(m => !m.el.isConnected);
    if (virtualized) {
      const step = Math.max(200, Math.floor(scroller.clientHeight * 0.8));
      for (let y = 0; y <= scroller.scrollHeight && Date.now() - start < maxMs * 2; y += step) {
        scroller.scrollTop = y;
        await sleep(400);
        acc = mergeSnapshot(acc, snapshot(adapter));
        progress({ stage: 'collecting', count: acc.length });
      }
    }
    scroller.scrollTop = virtualized ? scroller.scrollHeight : originalTop;
    return { acc, incomplete };
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  function getAdapter() {
    return adapters.find(a => {
      try { return a.matches(location); } catch { return false; }
    });
  }

  /**
   * Extracts the current conversation.
   * @param {{loadHistory?: boolean}} options
   * @param {(p: object) => void} onProgress
   */
  async function run(options = {}, onProgress = () => {}) {
    const progress = p => { try { onProgress(p); } catch { /* popup may be closed */ } };
    const adapter = getAdapter();
    if (!adapter) {
      return { ok: false, code: 'UNSUPPORTED', error: 'This page is not a supported AI chat (ChatGPT, Claude or Gemini).' };
    }

    progress({ stage: 'waiting', count: 0 });
    await waitForStableCount(adapter, { quietMs: options.quietMs || 600 });

    let acc = snapshot(adapter);
    progress({ stage: 'reading', count: acc.length });

    if (!acc.length) {
      const inConversation = Boolean(adapter.getConversationId && adapter.getConversationId());
      return inConversation
        ? { ok: false, code: 'COMPAT', platform: adapter.id, error: `No messages were found on this ${adapter.name} conversation page. The page may still be loading, or ${adapter.name} changed its layout and the extension needs an update. Nothing was extracted.` }
        : { ok: false, code: 'NO_MESSAGES', platform: adapter.id, error: `No conversation is open. Open an existing ${adapter.name} conversation and try again.` };
    }

    const signals = { notes: [] };
    if (options.loadHistory !== false) {
      const res = await loadHistory(adapter, acc, progress, { settleMs: options.historySettleMs || 900, maxMs: options.historyMaxMs || 25000 });
      acc = res.acc;
      signals.historyIncomplete = res.incomplete;
    } else {
      signals.historyLoadSkipped = true;
    }

    // Final pass picks up text that finished rendering during scrolling.
    acc = mergeSnapshot(acc, snapshot(adapter));

    const disconnected = acc.filter(m => !m.el.isConnected).length;
    if (disconnected && !acc.some(m => m.el.isConnected)) {
      signals.notes.push('The page re-rendered during extraction; extract again if anything looks missing.');
    }
    signals.streaming = Boolean(adapter.isStreaming && adapter.isStreaming());
    signals.collapsedContent = acc.filter(m => m.collapsed).length;
    signals.nonTextMessages = acc.filter(m => m.nonText).length;

    progress({ stage: 'done', count: acc.length });
    return {
      ok: true,
      platform: adapter.id,
      platformName: adapter.name,
      adapterVersion: adapter.version || 1,
      conversationId: (adapter.getConversationId && adapter.getConversationId()) || '',
      url: location.href,
      title: (adapter.getTitle && adapter.getTitle()) || document.title || '',
      extractedAt: new Date().toISOString(),
      messages: acc.map(m => ({ role: m.role, text: m.text, nativeId: m.nativeId })),
      signals,
    };
  }

  /** Inserts text into the platform's message box without sending it. */
  function insertIntoComposer(text) {
    const adapter = getAdapter();
    const selector = adapter && adapter.composerSelector;
    const el = selector && document.querySelector(selector);
    if (!el) return { ok: false, error: 'Message box not found on this page.' };
    el.focus();
    if (el.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, (el.value ? el.value + '\n\n' : '') + text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return { ok: true };
    }
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    const inserted = document.execCommand('insertText', false, text);
    if (!inserted) {
      el.textContent = (el.textContent ? el.textContent + '\n\n' : '') + text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    }
    return { ok: true };
  }

  window.CMAExtract = {
    registerAdapter: a => adapters.push(a),
    getAdapter,
    run,
    insertIntoComposer,
    domToMarkdown,
    outermostInOrder,
    mergeSnapshot,
    _adapters: adapters,
  };
})();
