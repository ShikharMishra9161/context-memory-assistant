import { analyzeConversation } from './analyze.js';
import { emptyHandoff, makeItem, coerceHandoff } from './schema.js';

const UNKNOWN = '';

function truncate(text, max) {
  return text.length > max ? text.slice(0, max).trimEnd() + '…' : text;
}

/** Copies verbatim artifacts (code, commands, paths, errors, URLs) into a handoff. */
export function attachArtifacts(handoff, analysis) {
  handoff.artifacts = {
    codeBlocks: analysis.codeBlocks.map(b => ({ language: b.language, code: b.code, ref: b.ref, role: b.role })),
    commands: analysis.commands,
    filePaths: analysis.filePaths,
    errors: analysis.errors,
    urls: analysis.urls,
  };
  return handoff;
}

/**
 * Builds a handoff with no LLM. Content is verbatim or heuristic, never invented.
 * @param {Array} messages normalized messages
 * @param {{projectName?:string, conversationTitle?:string, customInstructions?:string}} options
 */
export function buildDeterministicHandoff(messages, options = {}) {
  const a = analyzeConversation(messages);
  const h = emptyHandoff();
  const { firstParagraph, lastParagraph } = a.helpers;

  h.project.name = (options.projectName || '').trim() || (options.conversationTitle || '').trim() || UNKNOWN;
  if (a.firstUser) {
    h.project.purpose = `Opening request (verbatim excerpt from message #${a.firstUser.index + 1}): ${truncate(firstParagraph(a.firstUser.text, 800), 800)}`;
  }
  h.project.stack = a.stack;
  h.project.keyFiles = a.filePaths.slice(0, 60).map(p => makeItem(p, 'confirmed'));

  h.state.completed = a.completed;
  h.state.inProgress = [];
  h.state.notImplemented = a.todo;
  // The error text is verbatim, but whether it is still unresolved is not known.
  h.state.bugs = a.errors.slice(-25).map(e => makeItem(e, 'assumption'));

  h.decisions.decisions = a.decisions;
  h.decisions.rejected = a.rejected;
  h.decisions.preferences = a.preferences;
  h.decisions.constraints = a.constraints;
  h.decisions.security = a.security;
  h.decisions.dependencies = a.dependencies;

  if (a.lastUser) {
    h.currentTask.goal = `Latest user request (verbatim, message #${a.lastUser.index + 1}): ${truncate(a.lastUser.text.trim(), 3000)}`;
  }
  if (a.last) {
    h.currentTask.stoppedAt = a.last.role === 'user'
      ? 'The conversation ended on a user message; the assistant had not replied yet (or the reply was not captured).'
      : `The conversation ended on an assistant reply (message #${a.last.index + 1}). Its closing part: ${lastParagraph(a.last.text, 800)}`;
  }
  h.currentTask.attempted = a.tailAttempts;
  h.currentTask.failures = a.tailErrors;

  h.nextSteps.next = a.nextHints.length
    ? a.nextHints[a.nextHints.length - 1].text
    : a.lastUser ? 'Not stated explicitly. Continue with the latest user request above.' : UNKNOWN;
  h.nextSteps.remaining = a.nextHints.slice(0, -1);
  h.nextSteps.tests = a.testHints;
  h.nextSteps.openQuestions = a.openQuestions;

  h.customNotes = (options.customInstructions || '').trim();
  h.unknowns = [
    makeItem('Errors listed under known bugs appeared in the conversation; some may have been fixed later.', 'unknown'),
    makeItem('Which features are fully completed vs. in progress could not be determined reliably without an AI model; items above marked "assumption" were found by keyword matching.', 'unknown'),
  ];
  attachArtifacts(h, a);
  return coerceHandoff(h);
}
