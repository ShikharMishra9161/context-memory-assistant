// Content-script extraction tests: loads the real content scripts into jsdom
// pages that mimic each platform's DOM structure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import * as core from '../shared/handoff-core/index.js';

const read = p => readFileSync(new URL(`../extension/content/${p}`, import.meta.url), 'utf8');
const SCRIPTS = {
  core: read('extract-core.js'),
  listener: read('extract-listener.js'),
  chatgpt: read('adapters/chatgpt-adapter.js'),
  claude: read('adapters/claude-adapter.js'),
  gemini: read('adapters/gemini-adapter.js'),
};
// Results come from the jsdom realm; convert to plain Node values for deepEqual.
const plain = x => JSON.parse(JSON.stringify(x));
const run = async (w, ...args) => plain(await w.CMAExtract.run(...args));
const FAST = { quietMs: 50, historySettleMs: 30, historyMaxMs: 2000 };

function page(url, html, platform, { chrome } = {}) {
  const dom = new JSDOM(`<!doctype html><html><head><title>Test</title></head><body>${html}</body></html>`, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  if (chrome) w.chrome = chrome;
  w.eval(SCRIPTS.core);
  w.eval(SCRIPTS[platform]);
  if (chrome) w.eval(SCRIPTS.listener);
  return w;
}

const CHATGPT_HTML = `
<main>
  <article data-testid="conversation-turn-1">
    <h5 class="sr-only">You said:</h5>
    <div data-message-author-role="user" data-message-id="u1"><div class="whitespace-pre-wrap">How do I read a file in Python?</div></div>
  </article>
  <article data-testid="conversation-turn-2">
    <h6 class="sr-only">ChatGPT said:</h6>
    <div data-message-author-role="assistant" data-message-id="a1"><div class="markdown prose">
      <p>Use <code>open()</code>:</p>
      <pre><div><div class="flex"><span>python</span><button>Copy code</button></div><div><code class="hljs">with open("data.txt") as f:
    print(f.read())
</code></div></div></pre>
      <ol><li>Open the file</li><li>Read it<ul><li>nested point</li></ul></li></ol>
      <table><tr><th>Mode</th><th>Meaning</th></tr><tr><td>r</td><td>read</td></tr></table>
    </div><button data-testid="good-response-turn-action-button">Good</button></div>
  </article>
  <article data-testid="conversation-turn-3">
    <div data-message-author-role="user" data-message-id="u2"><div class="whitespace-pre-wrap">I get FileNotFoundError: [Errno 2] No such file or directory: 'data.txt'</div></div>
  </article>
  <div data-message-author-role="user" data-message-id="u2"><div class="whitespace-pre-wrap">I get FileNotFoundError: [Errno 2] No such file or directory: 'data.txt'</div></div>
</main>`;

test('ChatGPT: order, roles, code language, lists, tables, dedupe by message id', async () => {
  const w = page('https://chatgpt.com/c/abc-123', CHATGPT_HTML, 'chatgpt');
  const res = await run(w, FAST);
  assert.equal(res.ok, true);
  assert.equal(res.platform, 'chatgpt');
  assert.equal(res.conversationId, 'abc-123');
  assert.deepEqual(res.messages.map(m => m.role), ['user', 'assistant', 'user', 'user']);

  const ex = core.prepareExtraction(res);
  assert.equal(ex.stats.count, 3, 'duplicate node with the same message id is removed');
  assert.equal(ex.stats.duplicatesRemoved, 1);
  const answer = ex.messages[1].text;
  assert.match(answer, /Use `open\(\)`:/);
  assert.match(answer, /```python\nwith open\("data\.txt"\) as f:\n {4}print\(f\.read\(\)\)\n```/, 'code kept byte-for-byte with language');
  assert.ok(!answer.includes('Copy code'), 'button text removed');
  assert.ok(!answer.includes('Good'), 'action buttons removed');
  assert.match(answer, /1\. Open the file\n2\. Read it\n {3}- nested point/);
  assert.match(answer, /\| Mode \| Meaning \|\n\| --- \| --- \|\n\| r \| read \|/);
  assert.match(ex.messages[2].text, /FileNotFoundError: \[Errno 2\]/);
  assert.ok(!ex.messages[0].text.includes('You said'), 'screen-reader labels removed');
  assert.equal(res.signals.streaming, false);
});

test('ChatGPT: streaming response is flagged as partial', async () => {
  const w = page('https://chatgpt.com/c/x', CHATGPT_HTML + '<button data-testid="stop-button">Stop</button>', 'chatgpt');
  const ex = core.prepareExtraction(await run(w, FAST));
  assert.equal(ex.complete, false);
  assert.match(ex.warnings.join(), /still generating/);
});

test('ChatGPT: fallback to conversation turns when role attributes disappear', async () => {
  const html = `
    <article data-testid="conversation-turn-1"><h5 class="sr-only">You said:</h5><div>Hello there</div></article>
    <article data-testid="conversation-turn-2"><h6 class="sr-only">ChatGPT said:</h6><div>Hi! How can I help?</div></article>`;
  const w = page('https://chatgpt.com/c/x', html, 'chatgpt');
  const res = await run(w, FAST);
  assert.deepEqual(res.messages.map(m => [m.role, m.text]), [['user', 'Hello there'], ['assistant', 'Hi! How can I help?']]);
});

const CLAUDE_HTML = `
<div data-test-render-count="1"><div data-testid="user-message"><p>Refactor <code>auth.js</code> to use async/await.</p></div></div>
<div data-test-render-count="1"><div data-is-streaming="false"><div class="font-claude-response"><p>Here is the refactor:</p>
<pre><code class="language-javascript">async function login(user) {
  const res = await fetch('/login');
  return res.json();
}</code></pre>
<p>The math: <span class="katex"><span class="katex-mathml"><math><semantics><annotation encoding="application/x-tex">O(n^2)</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">O(n2)</span></span></p>
</div></div></div>
<div data-test-render-count="1"><div data-testid="user-message"><p>Thanks, now add tests.</p><button>Show more</button></div></div>
<div data-test-render-count="1"><div data-is-streaming="true"><div class="font-claude-response"><p>Sure, starting with</p></div></div></div>`;

test('Claude: messages, code language, KaTeX, collapsed and streaming signals', async () => {
  const w = page('https://claude.ai/chat/1111-2222', CLAUDE_HTML, 'claude');
  const res = await run(w, FAST);
  assert.equal(res.ok, true);
  assert.equal(res.conversationId, '1111-2222');
  assert.deepEqual(res.messages.map(m => m.role), ['user', 'assistant', 'user', 'assistant']);
  assert.equal(res.messages[0].text, 'Refactor `auth.js` to use async/await.');
  assert.match(res.messages[1].text, /```javascript\nasync function login\(user\) \{\n {2}const res = await fetch\('\/login'\);/);
  assert.match(res.messages[1].text, /The math: \$O\(n\^2\)\$/);
  assert.equal(res.signals.streaming, true);
  assert.equal(res.signals.collapsedContent, 1);
  const ex = core.prepareExtraction(res);
  assert.equal(ex.complete, false);
  assert.match(ex.warnings.join('\n'), /collapsed or truncated/);
});

function geminiPage() {
  const html = `<infinite-scroller>
    <div class="conversation-container"><user-query><span class="cdk-visually-hidden">You said</span><div class="query-text"><p class="query-text-line">Message 3 from user</p></div></user-query>
    <model-response><message-content><div class="markdown"><p>Reply 3</p></div></message-content><message-actions><button>Copy</button></message-actions></model-response></div>
  </infinite-scroller>`;
  const w = page('https://gemini.google.com/app/abc123', html, 'gemini');
  const scroller = w.document.querySelector('infinite-scroller');
  let loads = 0;
  // Older history is lazy-loaded when the user scrolls to the top, like Gemini does.
  scroller.addEventListener('scroll', () => {
    if (loads >= 2) return;
    const n = 2 - loads;
    loads++;
    const div = w.document.createElement('div');
    div.className = 'conversation-container';
    div.innerHTML = `<user-query><div class="query-text"><p>Message ${n} from user</p></div></user-query><model-response><message-content><div class="markdown"><p>Reply ${n}</p></div></message-content></model-response>`;
    scroller.insertBefore(div, scroller.firstChild);
  });
  return w;
}

test('Gemini: loads lazily rendered older history by scrolling up, in order', async () => {
  const w = geminiPage();
  const progress = [];
  const res = await run(w, FAST, p => progress.push(p.stage));
  assert.equal(res.ok, true);
  assert.deepEqual(res.messages.map(m => m.text), ['Message 1 from user', 'Reply 1', 'Message 2 from user', 'Reply 2', 'Message 3 from user', 'Reply 3']);
  assert.ok(progress.includes('loading-history'));
  assert.equal(progress[progress.length - 1], 'done');
  assert.equal(res.signals.historyIncomplete, false);
  assert.equal(core.prepareExtraction(res).complete, true);
});

test('Gemini: skipping history loading is reported as possibly incomplete', async () => {
  const w = geminiPage();
  const res = await run(w, { ...FAST, loadHistory: false });
  assert.equal(res.messages.length, 2);
  const ex = core.prepareExtraction(res);
  assert.equal(ex.complete, false);
  assert.match(ex.warnings.join(), /not loaded automatically/);
});

test('history loading that never settles is flagged as incomplete', async () => {
  const w = page('https://gemini.google.com/app/endless', '<infinite-scroller><user-query><div class="query-text">q</div></user-query><model-response><message-content>a</message-content></model-response></infinite-scroller>', 'gemini');
  const scroller = w.document.querySelector('infinite-scroller');
  let n = 0;
  scroller.addEventListener('scroll', () => {
    const div = w.document.createElement('div');
    div.innerHTML = `<user-query><div class="query-text">older ${n}</div></user-query><model-response><message-content>older reply ${n++}</message-content></model-response>`;
    scroller.insertBefore(div, scroller.firstChild);
  });
  const res = await run(w, { quietMs: 20, historySettleMs: 20, historyMaxMs: 300 });
  assert.equal(res.signals.historyIncomplete, true);
  assert.equal(core.prepareExtraction(res).complete, false);
});

test('errors: unsupported site, no conversation open, and changed page layout', async () => {
  const other = page('https://example.com/', '<p>hi</p>', 'chatgpt');
  assert.equal((await run(other, FAST)).code, 'UNSUPPORTED');

  const newChat = page('https://claude.ai/new', '<div>How can I help you today?</div>', 'claude');
  const r1 = await run(newChat, FAST);
  assert.equal(r1.ok, false);
  assert.equal(r1.code, 'NO_MESSAGES');

  const changed = page('https://claude.ai/chat/abc', '<div class="totally-new-layout"><p>message</p></div>', 'claude');
  const r2 = await run(changed, FAST);
  assert.equal(r2.code, 'COMPAT');
  assert.match(r2.error, /changed its layout/);
});

test('content-script listener answers ping, extract and insert messages', async () => {
  let handler;
  const sent = [];
  const chrome = {
    runtime: {
      onMessage: { addListener: fn => { handler = fn; } },
      sendMessage: msg => { sent.push(msg); return Promise.resolve(); },
    },
  };
  const w = page('https://chatgpt.com/c/zzz', CHATGPT_HTML + '<textarea id="prompt-textarea"></textarea>', 'chatgpt', { chrome });
  const call = msg => new Promise(resolve => handler(msg, {}, r => resolve(plain(r))));

  assert.deepEqual(await call({ type: 'CMA_PING' }), { ok: true, platform: 'chatgpt', newChatUrl: 'https://chatgpt.com/' });
  const res = await call({ type: 'CMA_EXTRACT', requestId: 'r1', options: FAST });
  assert.equal(res.ok, true);
  assert.ok(sent.some(m => m.type === 'CMA_EXTRACT_PROGRESS' && m.requestId === 'r1'));
  const ins = await call({ type: 'CMA_INSERT_TEXT', text: 'handoff text' });
  assert.equal(ins.ok, true);
  assert.equal(w.document.querySelector('#prompt-textarea').value, 'handoff text');
  assert.equal(handler({ type: 'SOMETHING_ELSE' }, {}, () => {}), undefined, 'unrelated messages are ignored');
});

test('scripts are idempotent when injected twice (manifest + scripting fallback)', async () => {
  const w = page('https://chatgpt.com/c/x', CHATGPT_HTML, 'chatgpt');
  w.eval(SCRIPTS.core);
  w.eval(SCRIPTS.chatgpt);
  assert.equal(w.CMAExtract._adapters.length, 1);
});

test('mergeSnapshot keeps order when a virtualized list swaps nodes', () => {
  const w = page('https://chatgpt.com/c/x', '', 'chatgpt');
  const mk = k => ({ key: k });
  const bottom = [mk('c'), mk('d'), mk('e')];
  const top = [mk('a'), mk('b'), mk('c')];
  assert.deepEqual(plain(w.CMAExtract.mergeSnapshot(bottom, top).map(m => m.key)), ['a', 'b', 'c', 'd', 'e']);
  const later = [mk('d'), mk('e'), mk('f')];
  assert.deepEqual(plain(w.CMAExtract.mergeSnapshot(w.CMAExtract.mergeSnapshot(bottom, top), later).map(m => m.key)), ['a', 'b', 'c', 'd', 'e', 'f']);
});
