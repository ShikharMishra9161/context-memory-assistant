// Hand-written request validators (no schema library dependency).
const { HttpError } = require('../lib/http');

const MODES = ['quick', 'continue', 'full', 'custom'];
const PLATFORMS = ['chatgpt', 'claude', 'gemini', ''];
const ROLES = ['user', 'assistant', 'system', 'unknown'];

const LIMITS = {
  messages: 5000,
  messageChars: 200000,
  totalChars: 4000000,
  markdownChars: 3000000,
  title: 200,
  projectName: 200,
  customInstructions: 10000,
  warnings: 50,
  tags: 20,
};

function str(errors, obj, key, { max, required = false, oneOf } = {}) {
  const v = obj[key];
  if (v === undefined || v === null || v === '') {
    if (required) errors.push(`${key} is required`);
    return '';
  }
  if (typeof v !== 'string') { errors.push(`${key} must be a string`); return ''; }
  if (max && v.length > max) errors.push(`${key} must be at most ${max} characters`);
  if (oneOf && !oneOf.includes(v)) errors.push(`${key} must be one of: ${oneOf.filter(Boolean).join(', ')}`);
  return v;
}

function strArray(errors, obj, key, { maxItems, maxLen = 500 }) {
  const v = obj[key];
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.some(x => typeof x !== 'string')) { errors.push(`${key} must be an array of strings`); return []; }
  if (v.length > maxItems) errors.push(`${key} must have at most ${maxItems} items`);
  return v.map(x => x.slice(0, maxLen)).slice(0, maxItems);
}

function fail(errors) {
  if (errors.length) throw new HttpError(400, `Invalid request: ${errors.slice(0, 5).join('; ')}`, 'VALIDATION', errors);
}

function validateGenerate(body) {
  const errors = [];
  if (!body || typeof body !== 'object') fail(['body must be a JSON object']);
  const mode = str(errors, body, 'mode', { oneOf: MODES }) || 'continue';
  const projectName = str(errors, body, 'projectName', { max: LIMITS.projectName });
  const customInstructions = str(errors, body, 'customInstructions', { max: LIMITS.customInstructions });
  if (mode === 'custom' && !customInstructions.trim()) errors.push('customInstructions is required for Custom Handoff mode');

  const ex = body.extraction;
  if (!ex || typeof ex !== 'object') fail([...errors, 'extraction is required']);
  const platform = str(errors, ex, 'platform', { oneOf: PLATFORMS });
  const title = str(errors, ex, 'title', { max: 500 });
  const url = str(errors, ex, 'url', { max: 2000 });
  const conversationId = str(errors, ex, 'conversationId', { max: 200 });
  const extractedAt = str(errors, ex, 'extractedAt', { max: 40 });
  const warnings = strArray(errors, ex, 'warnings', { maxItems: LIMITS.warnings });

  if (!Array.isArray(ex.messages)) fail([...errors, 'extraction.messages must be an array']);
  if (ex.messages.length === 0) errors.push('extraction.messages is empty — nothing to generate a handoff from');
  if (ex.messages.length > LIMITS.messages) errors.push(`extraction.messages must have at most ${LIMITS.messages} items`);
  let total = 0;
  const messages = [];
  ex.messages.slice(0, LIMITS.messages).forEach((m, i) => {
    if (!m || typeof m !== 'object' || typeof m.text !== 'string') { errors.push(`messages[${i}].text must be a string`); return; }
    if (!ROLES.includes(m.role)) { errors.push(`messages[${i}].role must be one of ${ROLES.join(', ')}`); return; }
    if (m.text.length > LIMITS.messageChars) errors.push(`messages[${i}] exceeds ${LIMITS.messageChars} characters`);
    total += m.text.length;
    messages.push({ role: m.role, text: m.text, nativeId: typeof m.nativeId === 'string' ? m.nativeId.slice(0, 200) : undefined });
  });
  if (total > LIMITS.totalChars) errors.push(`conversation exceeds ${LIMITS.totalChars} characters`);
  fail(errors);

  return {
    mode,
    projectName: projectName.trim(),
    customInstructions: customInstructions.trim(),
    extraction: {
      platform, title, url, conversationId, extractedAt, warnings,
      complete: ex.complete === true,
      messages,
    },
  };
}

function validateHandoffInput(body, { partial = false } = {}) {
  const errors = [];
  if (!body || typeof body !== 'object') fail(['body must be a JSON object']);
  const out = {};
  const set = (key, value) => { if (body[key] !== undefined) out[key] = value; };

  set('title', str(errors, body, 'title', { max: LIMITS.title, required: !partial }).trim());
  set('projectName', str(errors, body, 'projectName', { max: LIMITS.projectName }).trim());
  set('markdown', str(errors, body, 'markdown', { max: LIMITS.markdownChars, required: !partial }));
  set('mode', str(errors, body, 'mode', { oneOf: MODES }));
  set('platform', str(errors, body, 'platform', { oneOf: PLATFORMS }));
  set('sourceUrl', str(errors, body, 'sourceUrl', { max: 2000 }));
  set('conversationId', str(errors, body, 'conversationId', { max: 200 }));
  set('clientId', str(errors, body, 'clientId', { max: 100 }));
  set('tags', strArray(errors, body, 'tags', { maxItems: LIMITS.tags, maxLen: 50 }));
  set('warnings', strArray(errors, body, 'warnings', { maxItems: LIMITS.warnings }));
  if (body.messageCount !== undefined) {
    if (!Number.isInteger(body.messageCount) || body.messageCount < 0) errors.push('messageCount must be a non-negative integer');
    else out.messageCount = body.messageCount;
  }
  if (body.complete !== undefined) {
    if (typeof body.complete !== 'boolean') errors.push('complete must be a boolean');
    else out.complete = body.complete;
  }
  if (body.handoff !== undefined) {
    if (body.handoff !== null && (typeof body.handoff !== 'object' || Array.isArray(body.handoff))) errors.push('handoff must be an object');
    else if (JSON.stringify(body.handoff || {}).length > LIMITS.markdownChars) errors.push('handoff is too large');
    else out.handoff = body.handoff;
  }
  if (partial && Object.keys(out).length === 0) errors.push('no updatable fields supplied');
  if (out.title !== undefined && !out.title && !partial) errors.push('title is required');
  if (partial && out.title !== undefined && !out.title) errors.push('title cannot be empty');
  fail(errors);
  return out;
}

const MEMORY_CATEGORIES = ['project', 'skill', 'goal', 'note'];

function validateMemoryInput(body, { partial = false } = {}) {
  const errors = [];
  if (!body || typeof body !== 'object') fail(['body must be a JSON object']);
  const out = {};
  const category = str(errors, body, 'category', { oneOf: MEMORY_CATEGORIES, required: !partial });
  const title = str(errors, body, 'title', { max: 200, required: !partial });
  const content = str(errors, body, 'content', { max: 20000, required: !partial });
  const tags = strArray(errors, body, 'tags', { maxItems: 20, maxLen: 50 });
  if (body.category !== undefined) out.category = category;
  if (body.title !== undefined) out.title = title.trim();
  if (body.content !== undefined) out.content = content.trim();
  if (body.tags !== undefined) out.tags = tags.map(t => t.trim()).filter(Boolean);
  fail(errors);
  return out;
}

module.exports = { validateGenerate, validateHandoffInput, validateMemoryInput, LIMITS, MODES };
