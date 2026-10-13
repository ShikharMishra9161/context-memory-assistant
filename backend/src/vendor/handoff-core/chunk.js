import { FIELDS, coerceHandoff, emptyHandoff } from './schema.js';

/** Formats messages as a plain transcript for an LLM prompt. */
export function formatTranscript(messages) {
  return messages
    .map(m => `=== Message #${m.index + 1}${m.part ? ` (piece ${m.part})` : ''} — ${m.role.toUpperCase()} ===\n${m.text}`)
    .join('\n\n');
}

/**
 * Splits messages into chunks whose formatted size stays under maxChars.
 * A single oversized message is split into pieces — content is never dropped.
 */
export function chunkMessages(messages, maxChars) {
  const overhead = 60;
  const pieces = [];
  for (const m of messages) {
    if (m.text.length + overhead <= maxChars) { pieces.push(m); continue; }
    const size = Math.max(1000, maxChars - overhead);
    const count = Math.ceil(m.text.length / size);
    for (let i = 0; i < count; i++) {
      pieces.push({ ...m, text: m.text.slice(i * size, (i + 1) * size), part: `${i + 1}/${count}` });
    }
  }
  const chunks = [];
  let cur = [];
  let size = 0;
  for (const p of pieces) {
    const len = p.text.length + overhead;
    if (cur.length && size + len > maxChars) { chunks.push(cur); cur = []; size = 0; }
    cur.push(p); size += len;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

function mergeItems(lists) {
  const map = new Map();
  for (const items of lists) {
    for (const it of items || []) {
      const key = it.text.toLowerCase().replace(/\s+/g, ' ');
      const existing = map.get(key);
      if (existing) {
        existing.refs = [...new Set([...existing.refs, ...it.refs])];
        if (it.status === 'confirmed') existing.status = 'confirmed';
      } else {
        map.set(key, { ...it, refs: [...(it.refs || [])] });
      }
    }
  }
  return [...map.values()];
}

// Text fields describing "now" come from the latest chunk; project facts from the earliest.
const LATEST_WINS = new Set(['currentTask.goal', 'currentTask.stoppedAt', 'nextSteps.next']);

/** Merges handoffs produced from consecutive chunks (oldest first) without discarding items. */
export function mergeHandoffs(handoffs) {
  const list = handoffs.map(coerceHandoff);
  if (list.length === 1) return list[0];
  const out = emptyHandoff();
  for (const [section, field, kind] of FIELDS) {
    if (kind === 'list') {
      out[section][field] = mergeItems(list.map(h => h[section][field]));
    } else {
      const values = list.map(h => h[section][field]).filter(Boolean);
      if (LATEST_WINS.has(`${section}.${field}`)) out[section][field] = values[values.length - 1] || '';
      else if (field === 'architecture' || field === 'problem' || field === 'purpose') out[section][field] = [...new Set(values)].join('\n\n');
      else out[section][field] = values[0] || '';
    }
  }
  out.unknowns = mergeItems(list.map(h => h.unknowns));
  out.customNotes = list.map(h => h.customNotes).find(Boolean) || '';
  return out;
}

/** Tolerant JSON extraction from model output (handles ```json fences and stray prose). */
export function parseJsonLoose(text) {
  if (typeof text !== 'string') throw new Error('Model returned no text');
  const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('Model output did not contain a JSON object');
  return JSON.parse(candidate.slice(start, end + 1));
}
