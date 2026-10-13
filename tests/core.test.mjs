import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../shared/handoff-core/index.js';

const conv = (...pairs) => pairs.map(([role, text]) => ({ role, text }));

test('normalize: keeps order, roles and code; strips UI noise outside code only', () => {
  const { messages, stats } = core.normalizeMessages(conv(
    ['user', 'First question\nCopy code'],
    ['model', 'Answer\n\n```bash\nCopy code\nnpm test\n```\nRegenerate'],
    ['human', 'Second'],
  ));
  assert.deepEqual(messages.map(m => m.role), ['user', 'assistant', 'user']);
  assert.deepEqual(messages.map(m => m.index), [0, 1, 2]);
  assert.equal(messages[0].text, 'First question');
  assert.match(messages[1].text, /```bash\nCopy code\nnpm test\n```/, 'noise-like lines inside code are kept');
  assert.ok(!messages[1].text.includes('Regenerate'));
  assert.deepEqual(messages[1].codeBlocks, [{ language: 'bash', code: 'Copy code\nnpm test' }]);
  assert.equal(stats.count, 3);
});

test('normalize: removes duplicates (same native id, adjacent re-render) but keeps genuine repeats', () => {
  const { messages, stats } = core.normalizeMessages([
    { role: 'user', text: 'yes', nativeId: 'a' },
    { role: 'assistant', text: 'ok', nativeId: 'b' },
    { role: 'assistant', text: 'ok', nativeId: 'b' }, // same id twice
    { role: 'user', text: 'yes', nativeId: 'c' }, // user repeated themselves — keep
    { role: 'user', text: 'yes' }, // adjacent identical re-render — drop
    { role: 'assistant', text: '   ' }, // empty
    null,
  ]);
  assert.deepEqual(messages.map(m => m.text), ['yes', 'ok', 'yes']);
  assert.equal(stats.duplicatesRemoved, 2);
  assert.equal(stats.emptySkipped, 2);
});

test('completeness: empty, streaming, history, gaps and the clean case', () => {
  const empty = core.assessCompleteness(core.normalizeMessages([]));
  assert.equal(empty.complete, false);
  assert.match(empty.warnings[0], /No conversation messages/);

  const clean = core.assessCompleteness(core.normalizeMessages(conv(['user', 'a'], ['assistant', 'b'])), {});
  assert.deepEqual(clean, { complete: true, warnings: [] });

  const streaming = core.assessCompleteness(core.normalizeMessages(conv(['user', 'a'], ['assistant', 'b'])), { streaming: true });
  assert.equal(streaming.complete, false);
  assert.match(streaming.warnings.join(), /still generating/);

  const history = core.assessCompleteness(core.normalizeMessages(conv(['user', 'a'], ['assistant', 'b'])), { historyIncomplete: true });
  assert.equal(history.complete, false);

  const gaps = core.assessCompleteness(core.normalizeMessages(conv(['assistant', 'x'], ['user', 'a'], ['user', 'b'])));
  assert.equal(gaps.complete, false);
  assert.match(gaps.warnings.join('\n'), /same speaker appears twice/);
  assert.match(gaps.warnings.join('\n'), /opening user message may be missing/);
});

const SAMPLE = conv(
  ['user', 'I am building TaskFlow, a React + Express todo app. We must keep MongoDB. I prefer functional components. Never commit the .env file.'],
  ['assistant', "Let's use Mongoose for the models. Create `server/models/Task.js`:\n\n```js\nconst Task = mongoose.model('Task', schema);\nmodule.exports = Task;\n```\n\nThen run:\n\n```bash\nnpm install mongoose\nnpm run dev\n```"],
  ['user', 'Redux did not work for us, so we use Context instead of Redux. Now I get:\n\nTypeError: Cannot read properties of undefined (reading \'map\')\n    at TaskList (src/components/TaskList.jsx:14:22)'],
  ['assistant', 'Initialize tasks with an empty array in `TaskList.jsx`. That fixed the crash once state loads.\n\nNext step: add the PATCH /tasks/:id endpoint. Should completed tasks be archived or deleted?'],
);

test('deterministic handoff preserves code, commands, errors, files, constraints', () => {
  const { messages } = core.normalizeMessages(SAMPLE);
  const h = core.buildDeterministicHandoff(messages, { projectName: 'TaskFlow' });
  assert.equal(h.project.name, 'TaskFlow');
  assert.ok(h.artifacts.codeBlocks.some(b => b.language === 'js' && b.code.includes("mongoose.model('Task', schema)")));
  assert.deepEqual(h.artifacts.commands, ['npm install mongoose', 'npm run dev']);
  assert.ok(h.artifacts.errors.some(e => e.includes("TypeError: Cannot read properties of undefined (reading 'map')") && e.includes('TaskList.jsx:14:22')));
  assert.ok(h.artifacts.filePaths.includes('server/models/Task.js'));
  assert.ok(h.artifacts.filePaths.includes('src/components/TaskList.jsx'));
  const constraints = h.decisions.constraints.map(i => i.text);
  assert.ok(constraints.some(t => t.includes('We must keep MongoDB')));
  assert.ok(constraints.some(t => t.includes('Never commit the .env file')));
  assert.ok(h.decisions.constraints.every(i => i.status === 'confirmed'), 'user statements are confirmed quotes');
  assert.ok(h.decisions.preferences.some(i => i.text.includes('prefer functional components')));
  assert.ok(h.decisions.rejected.some(i => /instead of Redux|did not work/.test(i.text)));
  assert.ok(h.decisions.decisions.some(i => i.text.includes("Let's use Mongoose")));
  assert.equal(h.nextSteps.next, 'Next step: add the PATCH /tasks/:id endpoint.');
  assert.ok(h.nextSteps.openQuestions.some(q => q.text.includes('archived or deleted')));
  assert.match(h.currentTask.goal, /Latest user request/);
  assert.ok(h.decisions.dependencies.some(d => d.text === 'mongoose'));
});

test('deterministic handoff handles empty conversations without inventing content', () => {
  const h = core.buildDeterministicHandoff([], {});
  assert.equal(h.project.name, '');
  assert.equal(h.currentTask.goal, '');
  assert.equal(h.artifacts.codeBlocks.length, 0);
  const md = core.renderHandoffMarkdown({ ...h, meta: { extraction: { messageCount: 0, complete: false, warnings: ['No conversation messages were found on this page.'] }, generator: { type: 'deterministic' } } });
  assert.match(md, /PARTIAL EXTRACTION/);
  assert.match(md, /Not determined from the conversation/);
});

test('markdown: modes, partial label, instructions, custom notes, transcript', () => {
  const ex = core.prepareExtraction({ platform: 'claude', title: 'TaskFlow chat', messages: SAMPLE, signals: { streaming: true } });
  assert.equal(ex.complete, false);
  const quick = core.generateDeterministic(ex, { mode: 'quick' }).markdown;
  const cont = core.generateDeterministic(ex, { mode: 'continue' }).markdown;
  const full = core.generateDeterministic(ex, { mode: 'full' }).markdown;
  const custom = core.generateDeterministic(ex, { mode: 'custom', customInstructions: 'Remember: deploy target is Fly.io' }).markdown;

  for (const md of [quick, cont, full, custom]) {
    assert.match(md, /PARTIAL EXTRACTION/);
    assert.match(md, /still generating/);
    assert.match(md, /Instructions for the next AI assistant/);
    assert.match(md, /Do not start over/);
    assert.match(md, /Begin with the next pending task: Next step: add the PATCH/);
  }
  assert.ok(quick.length < cont.length && cont.length < full.length);
  assert.ok(!quick.includes('## B. Current implementation state'));
  assert.match(cont, /## B\. Current implementation state/);
  assert.match(cont, /```js\nconst Task = mongoose\.model/);
  assert.match(full, /Appendix: conversation transcript/);
  assert.match(full, /#### Message #4 — assistant/);
  assert.match(custom, /## Must remember \(specified by the user\)\n\nRemember: deploy target is Fly\.io/);
  assert.ok(!cont.includes('Must remember'));
  assert.match(cont, /Claude conversation — 4 messages extracted/);
});

test('markdown: code containing backticks gets a longer fence', () => {
  const h = core.buildDeterministicHandoff(core.normalizeMessages(conv(['user', 'x'], ['assistant', '````md\n```js\ninner\n```\n````'])).messages);
  const md = core.renderHandoffMarkdown({ ...h, meta: { generator: { type: 'deterministic' }, extraction: { complete: true, messageCount: 2 } } }, { mode: 'continue' });
  assert.match(md, /````md\n```js\ninner\n```\n````/);
});

test('splitIntoParts: bounded parts, balanced fences, nothing lost, master index', () => {
  const messages = [];
  for (let i = 0; i < 80; i++) {
    messages.push({ role: 'user', text: `Question ${i}: ` + 'details '.repeat(60) });
    messages.push({ role: 'assistant', text: `Answer ${i}\n\n\`\`\`js\n${Array.from({ length: 30 }, (_, j) => `const v${i}_${j} = ${j};`).join('\n')}\n\`\`\`` });
  }
  const ex = core.prepareExtraction({ platform: 'chatgpt', messages });
  const { markdown } = core.generateDeterministic(ex, { mode: 'full' });
  const max = 8000;
  const parts = core.splitIntoParts(markdown, max);
  assert.ok(parts.length > 3);
  for (const p of parts) {
    assert.ok(p.content.length <= max + 400, `part ${p.index} is ${p.content.length} chars`);
    const fences = p.content.split('\n').filter(l => /^```/.test(l)).length;
    assert.equal(fences % 2, 0, `part ${p.index} has balanced code fences`);
    assert.equal(p.total, parts.length);
  }
  assert.match(parts[0].content, /part 1 of/);
  assert.match(parts[parts.length - 1].content, /This is the final part/);
  const joined = parts.map(p => p.content).join('\n');
  for (let i = 0; i < 80; i++) {
    assert.ok(joined.includes(`const v${i}_29 = 29;`), `code from answer ${i} survives splitting`);
    assert.ok(joined.includes(`Question ${i}:`));
  }
  const index = core.buildPartsIndex(parts, 'Big project');
  assert.match(index, new RegExp(`split into ${parts.length} parts`));
  assert.equal(core.splitIntoParts('short', 100).length, 1);
});

test('splitIntoParts: a single huge code block is split into closed fences', () => {
  const code = Array.from({ length: 2000 }, (_, i) => `line ${i}`).join('\n');
  const parts = core.splitIntoParts('# Title\n\n```py\n' + code + '\n```\n', 3000);
  assert.ok(parts.length > 3);
  const all = parts.map(p => p.content).join('\n');
  assert.ok(all.includes('line 0') && all.includes('line 1999'));
  for (const p of parts) assert.equal(p.content.split('\n').filter(l => /^```/.test(l)).length % 2, 0);
});

test('chunkMessages: respects budget and never drops text', () => {
  const messages = core.normalizeMessages([
    { role: 'user', text: 'a'.repeat(500) },
    { role: 'assistant', text: 'b'.repeat(25000) }, // larger than one chunk
    { role: 'user', text: 'c'.repeat(500) },
  ]).messages;
  const chunks = core.chunkMessages(messages, 10000);
  assert.ok(chunks.length >= 3);
  for (const c of chunks) assert.ok(c.reduce((n, m) => n + m.text.length + 60, 0) <= 10000);
  const text = chunks.flat().map(m => m.text).join('');
  assert.equal(text.length, 26000);
  assert.ok(chunks.flat().some(m => m.part === '1/3'));
});

test('mergeHandoffs: unions lists, latest chunk wins for current state', () => {
  const a = { project: { name: 'P', purpose: 'first' }, state: { completed: [{ text: 'Login', status: 'assumption', refs: [1] }] }, currentTask: { goal: 'old goal' } };
  const b = { project: { name: 'Q', purpose: 'second' }, state: { completed: [{ text: 'login', status: 'confirmed', refs: [5] }, { text: 'Signup', status: 'confirmed', refs: [6] }] }, currentTask: { goal: 'new goal' } };
  const m = core.mergeHandoffs([a, b]);
  assert.equal(m.project.name, 'P');
  assert.equal(m.project.purpose, 'first\n\nsecond');
  assert.equal(m.currentTask.goal, 'new goal');
  assert.equal(m.state.completed.length, 2);
  assert.deepEqual(m.state.completed[0].refs, [1, 5]);
  assert.equal(m.state.completed[0].status, 'confirmed');
});

test('coerceHandoff and parseJsonLoose tolerate malformed model output', () => {
  const h = core.coerceHandoff({ project: { name: 42, features: ['x', null, { text: '' }, { text: 'y', status: 'bogus', refs: [1, -1, 'a'] }] }, state: 'nope', extra: 1 });
  assert.equal(h.project.name, '42');
  assert.deepEqual(h.project.features.map(i => i.text), ['x', 'y']);
  assert.equal(h.project.features[1].status, 'assumption');
  assert.deepEqual(h.project.features[1].refs, [1]);
  assert.deepEqual(h.state.completed, []);
  assert.equal(h.extra, undefined);
  assert.deepEqual(core.parseJsonLoose('Here you go:\n```json\n{"a": 1}\n```'), { a: 1 });
  assert.deepEqual(core.parseJsonLoose('prefix {"b": [1]} suffix'), { b: [1] });
  assert.throws(() => core.parseJsonLoose('no json'), /JSON/);
});

test('very long conversations are processed quickly and completely', () => {
  const messages = [];
  for (let i = 0; i < 3000; i++) messages.push({ role: i % 2 ? 'assistant' : 'user', text: `Message ${i}. Edit src/file${i % 50}.js and run \`npm test\`.` });
  const start = Date.now();
  const ex = core.prepareExtraction({ platform: 'gemini', messages });
  const { handoff, markdown } = core.generateDeterministic(ex, { mode: 'full' });
  assert.ok(Date.now() - start < 5000, 'under 5s');
  assert.equal(handoff.meta.extraction.messageCount, 3000);
  assert.match(markdown, /Message #3000 — assistant/);
  assert.equal(handoff.artifacts.filePaths.length, 50);
});
