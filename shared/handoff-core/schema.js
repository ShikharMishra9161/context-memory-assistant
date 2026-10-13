// The structured handoff document shared by the extension and backend.
// Every list item is { text, status, refs } where status is one of STATUSES and
// refs are 0-based indexes of the source messages the item came from.

export const SCHEMA_VERSION = 1;

export const MODES = {
  quick: { label: 'Quick Summary', description: 'Short summary for ordinary conversations.' },
  continue: { label: 'Continue Project', description: 'Detailed technical handoff for ongoing development.' },
  full: { label: 'Full Handoff', description: 'Everything: decisions, status, errors, code and next steps.' },
  custom: { label: 'Custom Handoff', description: 'You specify what the next AI must remember.' },
};

export const STATUSES = ['confirmed', 'assumption', 'unknown'];

// Section layout: [sectionKey, fieldKey, kind]. 'list' fields hold items, 'text' fields hold a string.
export const FIELDS = [
  ['project', 'name', 'text'],
  ['project', 'purpose', 'text'],
  ['project', 'problem', 'text'],
  ['project', 'features', 'list'],
  ['project', 'stack', 'list'],
  ['project', 'architecture', 'text'],
  ['project', 'keyFiles', 'list'],
  ['state', 'completed', 'list'],
  ['state', 'inProgress', 'list'],
  ['state', 'notImplemented', 'list'],
  ['state', 'bugs', 'list'],
  ['state', 'codeChanges', 'list'],
  ['decisions', 'decisions', 'list'],
  ['decisions', 'rejected', 'list'],
  ['decisions', 'preferences', 'list'],
  ['decisions', 'constraints', 'list'],
  ['decisions', 'security', 'list'],
  ['decisions', 'dependencies', 'list'],
  ['currentTask', 'goal', 'text'],
  ['currentTask', 'stoppedAt', 'text'],
  ['currentTask', 'attempted', 'list'],
  ['currentTask', 'failures', 'list'],
  ['nextSteps', 'next', 'text'],
  ['nextSteps', 'remaining', 'list'],
  ['nextSteps', 'tests', 'list'],
  ['nextSteps', 'openQuestions', 'list'],
];

const MAX_TEXT = 20000;
const MAX_ITEMS = 200;

export function emptyHandoff() {
  const h = {
    schemaVersion: SCHEMA_VERSION,
    meta: {},
    project: {}, state: {}, decisions: {}, currentTask: {}, nextSteps: {},
    artifacts: { codeBlocks: [], commands: [], filePaths: [], errors: [], urls: [] },
    customNotes: '',
    unknowns: [],
  };
  for (const [section, field, kind] of FIELDS) h[section][field] = kind === 'list' ? [] : '';
  return h;
}

function clampText(v) {
  if (v === null || v === undefined) return '';
  return String(v).slice(0, MAX_TEXT).trim();
}

export function makeItem(text, status = 'assumption', refs = []) {
  return { text: clampText(text), status: STATUSES.includes(status) ? status : 'assumption', refs };
}

function coerceItem(v) {
  if (typeof v === 'string') return makeItem(v, 'assumption');
  if (!v || typeof v !== 'object') return null;
  const refs = Array.isArray(v.refs) ? v.refs.filter(n => Number.isInteger(n) && n >= 0).slice(0, 50) : [];
  const item = makeItem(v.text ?? v.value ?? '', v.status, refs);
  return item.text ? item : null;
}

function coerceList(v) {
  if (!Array.isArray(v)) return [];
  return v.map(coerceItem).filter(Boolean).slice(0, MAX_ITEMS);
}

function coerceStrings(v, max = MAX_ITEMS) {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim().slice(0, 2000)))].slice(0, max);
}

/**
 * Validates and coerces an arbitrary object (e.g. LLM JSON output) into a
 * well-formed handoff. Unknown keys are dropped; wrong types become empty.
 */
export function coerceHandoff(input) {
  const src = input && typeof input === 'object' ? input : {};
  const h = emptyHandoff();
  for (const [section, field, kind] of FIELDS) {
    const v = src[section]?.[field];
    h[section][field] = kind === 'list' ? coerceList(v) : clampText(typeof v === 'object' && v ? v.text : v);
  }
  const a = src.artifacts || {};
  h.artifacts.codeBlocks = Array.isArray(a.codeBlocks)
    ? a.codeBlocks
        .filter(b => b && typeof b.code === 'string' && b.code.trim())
        .map(b => ({
          language: clampText(b.language).slice(0, 40),
          code: String(b.code).slice(0, MAX_TEXT),
          ref: Number.isInteger(b.ref) ? b.ref : undefined,
          role: b.role === 'user' || b.role === 'assistant' ? b.role : undefined,
        }))
        .slice(0, MAX_ITEMS)
    : [];
  h.artifacts.commands = coerceStrings(a.commands);
  h.artifacts.filePaths = coerceStrings(a.filePaths);
  h.artifacts.errors = coerceStrings(a.errors);
  h.artifacts.urls = coerceStrings(a.urls);
  h.customNotes = clampText(src.customNotes);
  h.unknowns = coerceList(src.unknowns);
  h.meta = src.meta && typeof src.meta === 'object' ? { ...src.meta } : {};
  return h;
}
