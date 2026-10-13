// Bridges popup requests to the extraction core running in this tab.
(function () {
  if (window.__cmaExtractListener || !window.CMAExtract) return;
  window.__cmaExtractListener = true;

  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'CMA_PING') {
      const adapter = window.CMAExtract.getAdapter();
      reply({ ok: true, platform: adapter?.id || null, newChatUrl: adapter?.newChatUrl || null });
      return;
    }

    if (msg.type === 'CMA_EXTRACT') {
      const onProgress = p => {
        try {
          chrome.runtime.sendMessage({ type: 'CMA_EXTRACT_PROGRESS', requestId: msg.requestId, ...p }).catch(() => {});
        } catch { /* extension reloaded */ }
      };
      window.CMAExtract.run(msg.options || {}, onProgress)
        .then(reply)
        .catch(err => reply({ ok: false, code: 'EXCEPTION', error: `Extraction failed: ${err?.message || err}` }));
      return true; // async reply
    }

    if (msg.type === 'CMA_INSERT_TEXT') {
      try {
        reply(window.CMAExtract.insertIntoComposer(String(msg.text || '')));
      } catch (err) {
        reply({ ok: false, error: err?.message || String(err) });
      }
    }
  });
})();
