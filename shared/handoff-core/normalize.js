// Normalizes raw messages scraped from a chat page into a stable internal format
// and assesses whether the extraction is likely complete.

export const ROLES = ['user', 'assistant', 'system', 'unknown'];

// Lines that are page chrome rather than conversation content.
const NOISE_LINES = [
  /^copy( code)?$/i,
  /^copied!?$/i,
  /^edit$/i,
  /^retry$/i,
  /^regenerate( response)?$/i,
  /^share$/i,
  /^(good|bad) response$/i,
  /^read aloud$/i,
  /^show (more|less)$/i,
  /^show drafts$/i,
  /^\d+\s*\/\s*\d+$/, // "2 / 3" response pagination
  /^you said:?$/i,
  /^chatgpt said:?$/i,
  /^gemini said:?$/i,
];

/** Fast, non-cryptographic 32-bit FNV-1a hash, hex encoded. */
export function hashText(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Removes UI noise lines that sit outside code fences. Never touches fenced code. */
export function stripNoise(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let fence = null; // opening backtick run while inside a code fence
  for (const line of lines) {
    const m = line.match(/^\s*(`{3,})/);
    if (m) {
      if (!fence) fence = m[1];
      else if (m[1].length >= fence.length && line.trim() === m[1]) fence = null;
      out.push(line);
      continue;
    }
    if (!fence && NOISE_LINES.some(re => re.test(line.trim()))) continue;
    out.push(line);
  }
  // Collapse runs of blank lines outside code only.
  const collapsed = [];
  fence = null;
  for (const line of out) {
    const m = line.match(/^\s*(`{3,})/);
    if (m) {
      if (!fence) fence = m[1];
      else if (m[1].length >= fence.length && line.trim() === m[1]) fence = null;
    }
    if (!fence && line.trim() === '' && collapsed.length && collapsed[collapsed.length - 1].trim() === '') continue;
    collapsed.push(line);
  }
  return collapsed.join('\n').trim();
}

/** Pulls fenced code blocks (``` or longer fences) out of Markdown text. */
export function extractCodeBlocks(text) {
  const blocks = [];
  const re = /(?:^|\n)[ \t]*(`{3,})([^\n`]*)\n([\s\S]*?)\n[ \t]*\1[ \t]*(?=\n|$)/g;
  let m;
  while ((m = re.exec(text))) {
    blocks.push({ language: m[2].trim(), code: m[3] });
  }
  return blocks;
}

function normalizeRole(role) {
  const r = String(role || '').toLowerCase();
  if (r === 'user' || r === 'human') return 'user';
  if (r === 'assistant' || r === 'model' || r === 'ai' || r === 'bot') return 'assistant';
  if (r === 'system') return 'system';
  return 'unknown';
}

/**
 * Normalizes raw messages: cleans noise, removes duplicates, keeps page order.
 * @param {Array<{role:string,text:string,nativeId?:string}>} raw
 * @returns {{messages: Array, stats: object}}
 */
export function normalizeMessages(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const messages = [];
  const seenIds = new Set();
  let duplicatesRemoved = 0;
  let emptySkipped = 0;

  for (const item of list) {
    if (!item || typeof item !== 'object') { emptySkipped++; continue; }
    const role = normalizeRole(item.role);
    const text = stripNoise(item.text);
    if (!text) { emptySkipped++; continue; }

    const hash = hashText(`${role}\u0000${text}`);
    const nativeId = item.nativeId ? String(item.nativeId) : '';

    // Same native id rendered twice (virtualized lists, re-renders) is a duplicate.
    if (nativeId && seenIds.has(nativeId)) { duplicatesRemoved++; continue; }
    // Adjacent identical messages from the same role are almost always a re-render,
    // not a deliberate repeat. Non-adjacent repeats are kept: users do repeat themselves.
    const prev = messages[messages.length - 1];
    if (prev && prev.hash === hash) { duplicatesRemoved++; continue; }

    if (nativeId) seenIds.add(nativeId);
    messages.push({
      index: messages.length,
      role,
      text,
      hash,
      nativeId: nativeId || undefined,
      codeBlocks: extractCodeBlocks(text),
    });
  }

  const count = role => messages.filter(m => m.role === role).length;
  return {
    messages,
    stats: {
      received: list.length,
      count: messages.length,
      user: count('user'),
      assistant: count('assistant'),
      unknown: count('unknown'),
      duplicatesRemoved,
      emptySkipped,
      characters: messages.reduce((n, m) => n + m.text.length, 0),
    },
  };
}

/**
 * Decides whether an extraction can be presented as having no detected gaps.
 * `signals` come from the content script (DOM-level observations).
 * Returns { complete, warnings[] } — `complete` only means "no gap detected".
 */
export function assessCompleteness(normalized, signals = {}) {
  const warnings = [];
  const { messages, stats } = normalized;

  if (stats.count === 0) {
    warnings.push('No conversation messages were found on this page.');
  }
  if (signals.streaming) {
    warnings.push('The assistant was still generating a response; the last message may be cut off.');
  }
  if (signals.historyIncomplete) {
    warnings.push('Older messages may not have loaded. Scroll to the top of the conversation and extract again.');
  }
  if (signals.historyLoadSkipped) {
    warnings.push('Earlier history was not loaded automatically; messages above the visible area may be missing.');
  }
  if (signals.collapsedContent) {
    warnings.push(`${signals.collapsedContent} message(s) appear collapsed or truncated in the page ("Show more").`);
  }
  if (signals.nonTextMessages) {
    warnings.push(`${signals.nonTextMessages} message(s) contained no extractable text (images, files or canvases are not captured).`);
  }
  if (stats.emptySkipped > 0) {
    warnings.push(`${stats.emptySkipped} empty message element(s) were skipped.`);
  }
  if (stats.unknown > 0) {
    warnings.push(`${stats.unknown} message(s) could not be attributed to user or assistant.`);
  }
  if (Array.isArray(signals.notes)) warnings.push(...signals.notes.filter(Boolean).map(String));

  // Two consecutive messages from the same speaker usually mean one was not captured.
  let sameRoleRuns = 0;
  for (let i = 1; i < messages.length; i++) {
    if (messages[i].role === messages[i - 1].role && messages[i].role !== 'unknown') sameRoleRuns++;
  }
  if (sameRoleRuns > 0) {
    warnings.push(`${sameRoleRuns} place(s) where the same speaker appears twice in a row — a message in between may be missing.`);
  }
  if (messages.length > 0 && messages[0].role === 'assistant') {
    warnings.push('The first extracted message is from the assistant; the opening user message may be missing.');
  }

  return { complete: stats.count > 0 && warnings.length === 0, warnings };
}
