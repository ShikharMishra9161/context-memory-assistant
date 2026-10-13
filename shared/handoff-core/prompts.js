import { FIELDS } from './schema.js';
import { formatTranscript } from './chunk.js';

function schemaDescription() {
  const sections = {};
  for (const [section, field, kind] of FIELDS) {
    sections[section] = sections[section] || {};
    sections[section][field] = kind === 'list' ? '[Item]' : 'string';
  }
  sections.unknowns = '[Item]';
  return JSON.stringify(sections, null, 2);
}

const MODE_GUIDANCE = {
  quick: 'Keep it short: only the essentials needed to continue. Lists should have at most 5 items.',
  continue: 'This is an ongoing software project. Be detailed and technical: preserve file names, APIs, commands, configuration and the exact state of the work.',
  full: 'Prioritize completeness over brevity. Capture every decision, requirement, correction, error, implementation detail and open item. Do not merge distinct items together.',
  custom: 'Follow the user\'s custom instructions about what must be remembered, in addition to the normal handoff content.',
};

export function buildSystemPrompt() {
  return [
    'You produce structured context handoffs so a new AI conversation can continue the work of a previous one.',
    'Rules:',
    '- Use ONLY information present in the transcript. Never invent files, features, test results, APIs or facts.',
    '- Every list item is an object {"text": string, "status": "confirmed"|"assumption"|"unknown", "refs": [message numbers]}.',
    '  "confirmed" = explicitly stated in the transcript; "assumption" = reasonably inferred; "unknown" = an open gap worth flagging.',
    '  refs are the 1-based "Message #" numbers the item comes from.',
    '- Keep the distinction between what the USER required and what the ASSISTANT suggested. User corrections override earlier assistant suggestions.',
    '- Preserve exact identifiers: file paths, function names, commands, error messages, versions, environment variable names.',
    '- Record explicit decisions, corrections and rejected approaches with the reason when one was given.',
    '- Use an empty string or empty list when something is not in the transcript. Do not pad.',
    '- Respond with a single JSON object and nothing else.',
  ].join('\n');
}

export function buildChunkPrompt(messages, { index = 1, total = 1, mode = 'continue', projectName = '', customInstructions = '' } = {}) {
  const position = total > 1
    ? `This is chunk ${index} of ${total} of a longer conversation (in chronological order). Describe only what this chunk contains; later chunks will be merged. ${index < total ? 'For currentTask and nextSteps describe the state at the end of this chunk.' : 'This is the final chunk, so currentTask and nextSteps must describe where the whole conversation stopped.'}`
    : 'This is the complete extracted transcript.';
  return [
    position,
    MODE_GUIDANCE[mode] || MODE_GUIDANCE.continue,
    projectName ? `The user calls this project: "${projectName}".` : '',
    customInstructions ? `User's custom instructions about what the next AI must remember:\n"""\n${customInstructions}\n"""` : '',
    'Return JSON with exactly this shape (Item = {"text","status","refs"}):',
    schemaDescription(),
    'Field notes: currentTask.goal = what the user was trying to do in the latest messages; currentTask.stoppedAt = the precise point where work stopped; nextSteps.next = the single next concrete action.',
    'TRANSCRIPT START',
    formatTranscript(messages),
    'TRANSCRIPT END',
  ].filter(Boolean).join('\n\n');
}

export function buildConsolidatePrompt(mergedHandoff, { mode = 'continue' } = {}) {
  return [
    'Below is a handoff merged mechanically from several chunks of one conversation (oldest first). Consolidate it:',
    '- Remove exact duplicates and merge items that say the same thing (union their refs).',
    '- Move items to the correct field when the merge put them in the wrong one, e.g. a feature listed as in progress early on and completed later is completed.',
    '- Do NOT drop distinct information and do NOT add anything that is not already present.',
    MODE_GUIDANCE[mode] || MODE_GUIDANCE.continue,
    'Return the consolidated JSON in the same shape.',
    JSON.stringify(mergedHandoff),
  ].join('\n\n');
}
