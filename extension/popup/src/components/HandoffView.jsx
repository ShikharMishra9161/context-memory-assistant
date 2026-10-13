import { useEffect, useMemo, useRef, useState } from 'react';
import { MODES, prepareExtraction, splitIntoParts, buildPartsIndex } from '../../../../shared/handoff-core/index.js';
import { PLATFORMS } from '../lib/platforms';
import { extractFromTab, insertIntoTab, openNewChat } from '../lib/tabs';
import { generateHandoff } from '../lib/generate';
import { saveHandoff, listHandoffs, saveDraft, clearDraft } from '../lib/store';
import { copyText, downloadMarkdown } from '../lib/files';
import { Badge, Button, Field, Notice, Spinner, inputClass } from './ui';
import MessageInspector from './MessageInspector';

const STAGE_LABELS = {
  waiting: 'Waiting for the page to finish rendering…',
  reading: 'Reading messages…',
  'loading-history': 'Scrolling up to load earlier messages…',
  collecting: 'Collecting messages…',
  done: 'Extraction finished',
};

// Parses a manually pasted transcript using common "You said:" / "ChatGPT said:" style markers.
function parsePasted(text) {
  const userRe = /^(you|user|me|human)( said)?:?\s*$/i;
  const aiRe = /^(chatgpt|assistant|claude|gemini|ai|model)( said)?:?\s*$/i;
  const messages = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const role = userRe.test(line.trim()) ? 'user' : aiRe.test(line.trim()) ? 'assistant' : null;
    if (role) { cur = { role, text: '' }; messages.push(cur); continue; }
    if (!cur) { cur = { role: 'unknown', text: '' }; messages.push(cur); }
    cur.text += line + '\n';
  }
  return messages;
}

function defaultTitle(projectName, extraction) {
  const base = projectName || extraction?.title || 'Untitled handoff';
  return `${base} — ${new Date().toISOString().slice(0, 10)}`;
}

export default function HandoffView({ settings, tab, platform, initialDraft, onSaved }) {
  const [draft, setDraft] = useState(() => initialDraft || { mode: settings.defaultMode, projectName: '', customInstructions: '', targetId: null });
  const [phase, setPhase] = useState(initialDraft?.result ? 'review' : 'idle'); // idle | extracting | generating | review | continue
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState('preview'); // preview | edit | messages
  const [manual, setManual] = useState(false);
  const [pasted, setPasted] = useState('');
  const [status, setStatus] = useState(null); // { tone, text }
  const [existing, setExisting] = useState([]);
  const busy = phase === 'extracting' || phase === 'generating';
  const first = useRef(true);

  // Persist the working draft so nothing is lost when the popup closes.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    saveDraft(draft).catch(() => {});
  }, [draft]);

  useEffect(() => { listHandoffs().then(setExisting).catch(() => {}); }, []);

  const update = patch => setDraft(d => ({ ...d, ...patch }));
  const extraction = draft.extraction;
  const markdown = draft.markdown || '';
  const parts = useMemo(() => (markdown ? splitIntoParts(markdown, settings.maxPartChars) : []), [markdown, settings.maxPartChars]);

  async function runGenerate(ex, d = draft) {
    setPhase('generating');
    setError(null);
    const result = await generateHandoff({ extraction: ex, mode: d.mode, projectName: d.projectName.trim(), customInstructions: d.customInstructions, settings });
    update({
      extraction: ex,
      result,
      markdown: result.markdown,
      edited: false,
      title: d.title || defaultTitle(d.projectName.trim(), ex),
    });
    setStatus(result.notice ? { tone: 'warn', text: result.notice } : null);
    setView('preview');
    setPhase('review');
  }

  async function handleExtract() {
    if (draft.mode === 'custom' && !draft.customInstructions.trim()) {
      setError({ title: 'Custom Handoff needs instructions', text: 'Describe what the next AI must remember, or choose another mode.' });
      return;
    }
    setError(null);
    setStatus(null);
    setPhase('extracting');
    setProgress({ stage: 'waiting', count: 0 });
    const res = await extractFromTab(tab, { loadHistory: settings.loadHistory }, setProgress);
    if (!res?.ok) {
      setPhase(draft.result ? 'review' : 'idle');
      setError({
        title: res?.code === 'COMPAT' ? `${platform?.name || 'This site'} layout not recognized` : 'Extraction failed',
        text: res?.error || 'Unknown error.',
        canPaste: true,
      });
      return;
    }
    const ex = prepareExtraction(res);
    if (!ex.messageCount) {
      setPhase('idle');
      setError({ title: 'No messages found', text: 'The page did not contain any readable messages. Nothing was extracted.', canPaste: true });
      return;
    }
    await runGenerate(ex, { ...draft, title: '' });
  }

  async function handlePasted() {
    const messages = parsePasted(pasted);
    const ex = prepareExtraction({
      platform: platform?.id || '',
      title: 'Pasted conversation',
      url: tab?.url || '',
      messages,
      signals: { notes: ['The conversation was pasted manually, not extracted from the page; it may be incomplete.'] },
    });
    if (!ex.messageCount) { setError({ title: 'Nothing to use', text: 'Paste the conversation text first.' }); return; }
    setManual(false);
    setPasted('');
    await runGenerate(ex, { ...draft, title: '' });
  }

  async function handleRegenerate() {
    if (draft.edited && !window.confirm('Regenerating replaces your manual edits. Continue?')) return;
    await runGenerate(extraction, draft);
  }

  async function handleCopy(text = markdown, label = 'Handoff') {
    const ok = await copyText(text);
    setStatus(ok ? { tone: 'ok', text: `${label} copied to the clipboard.` } : { tone: 'error', text: 'Clipboard access failed. Select the text in Edit mode and copy it manually (Ctrl+C).' });
    return ok;
  }

  async function handleSaveAndContinue() {
    const title = (draft.title || '').trim() || defaultTitle(draft.projectName.trim(), extraction);
    // Copy first: clipboard writes need the click's user activation.
    const copied = await copyText(parts.length > 1 ? buildPartsIndex(parts, draft.projectName || title) + '\n' + parts[0].content : markdown);
    try {
      const saved = await saveHandoff({
        id: draft.targetId || undefined,
        title,
        projectName: draft.projectName.trim(),
        mode: draft.mode,
        platform: extraction.platform,
        sourceUrl: extraction.url,
        conversationId: extraction.conversationId,
        markdown,
        handoff: draft.edited ? { ...draft.result.handoff, meta: { ...draft.result.handoff.meta, editedByUser: true } } : draft.result.handoff,
        messageCount: extraction.messageCount,
        complete: extraction.complete,
        warnings: extraction.warnings,
      });
      update({ savedId: saved.id, targetId: saved.id, title });
      onSaved?.();
      const syncNote = saved.syncState === 'error' ? ` Saved locally; server sync failed (${saved.syncError}) and will be retried.` : saved.syncState === 'synced' ? ' Also synced to the backend.' : '';
      setStatus({
        tone: copied && saved.syncState !== 'error' ? 'ok' : 'warn',
        text: `Saved “${title}”.${syncNote} ${copied ? (parts.length > 1 ? 'Index + part 1 copied — paste it, then copy the other parts below in order.' : 'Handoff copied to the clipboard.') : 'Copy failed — use the Copy button below.'}`,
      });
      setPhase('continue');
    } catch (err) {
      setStatus({ tone: 'error', text: `Saving failed: ${err.message}. Your draft is kept; copy or download it so nothing is lost.` });
    }
  }

  async function handleInsert() {
    const res = await insertIntoTab(tab, parts.length > 1 ? parts[0].content : markdown);
    setStatus(res.ok ? { tone: 'ok', text: 'Inserted into the message box. Review it and press Send yourself.' } : { tone: 'error', text: `Could not insert: ${res.error} Paste with Ctrl+V instead.` });
  }

  async function handleStartOver() {
    if (draft.result && !draft.savedId && !window.confirm('Discard the unsaved handoff?')) return;
    await clearDraft();
    setDraft({ mode: settings.defaultMode, projectName: draft.projectName, customInstructions: '', targetId: null });
    setPhase('idle');
    setError(null);
    setStatus(null);
  }

  const gen = draft.result?.generator;
  const projects = [...new Set(existing.map(h => h.projectName).filter(Boolean))];

  return (
    <div className="flex flex-col gap-3">
      {/* Source tab */}
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2 min-w-0">
          {platform ? <Badge tone="info">{platform.name}</Badge> : <Badge>No AI chat</Badge>}
          <span className="text-slate-400 truncate" title={tab?.title}>{platform ? tab?.title || 'Current tab' : 'Open a ChatGPT, Claude or Gemini conversation'}</span>
        </div>
        {(draft.result || phase !== 'idle') && <Button variant="ghost" onClick={handleStartOver} disabled={busy}>Start over</Button>}
      </div>

      {/* Options */}
      {phase !== 'continue' && (
        <div className="flex flex-col gap-2.5">
          <div className="grid grid-cols-4 gap-1" role="radiogroup" aria-label="Context mode">
            {Object.entries(MODES).map(([id, m]) => (
              <button
                key={id}
                role="radio"
                aria-checked={draft.mode === id}
                title={m.description}
                onClick={() => update({ mode: id })}
                disabled={busy}
                className={`text-[11px] leading-tight px-1 py-1.5 rounded-md border transition-colors ${draft.mode === id ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-800 border-slate-700 hover:bg-slate-700 text-slate-300'}`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-slate-500 -mt-1">{MODES[draft.mode].description}</p>

          <Field label="Project name (optional)">
            <input list="cma-projects" className={inputClass} value={draft.projectName} disabled={busy}
              placeholder="e.g. Context Memory Assistant" onChange={e => update({ projectName: e.target.value })} />
            <datalist id="cma-projects">{projects.map(p => <option key={p} value={p} />)}</datalist>
          </Field>

          {draft.mode === 'custom' && (
            <Field label="What must the next AI remember?">
              <textarea rows={3} className={`${inputClass} resize-y`} value={draft.customInstructions} disabled={busy}
                placeholder="e.g. The API contract for /orders, that we use pnpm, and the open bug in checkout."
                onChange={e => update({ customInstructions: e.target.value })} />
            </Field>
          )}

          {!draft.result ? (
            <Button variant="primary" size="lg" onClick={handleExtract} disabled={!platform || busy}>
              {busy ? <><Spinner /> {phase === 'generating' ? 'Generating handoff…' : 'Extracting…'}</> : 'Extract Context'}
            </Button>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={handleExtract} disabled={!platform || busy}>{phase === 'extracting' ? <><Spinner /> Extracting…</> : 'Re-extract'}</Button>
              <Button onClick={handleRegenerate} disabled={busy || !extraction}>{phase === 'generating' ? <><Spinner /> Generating…</> : 'Regenerate'}</Button>
            </div>
          )}

          {busy && progress && phase === 'extracting' && (
            <p className="text-xs text-slate-400" aria-live="polite">{STAGE_LABELS[progress.stage] || progress.stage} {progress.count ? `(${progress.count} messages so far)` : ''}</p>
          )}
          {phase === 'generating' && (
            <p className="text-xs text-slate-400" aria-live="polite">{settings.useBackendAI ? 'Asking the backend AI to build the handoff (long chats can take a minute)…' : 'Building the handoff locally…'}</p>
          )}
          {!platform && !draft.result && (
            <p className="text-[11px] text-slate-500">Switch to a tab with an open ChatGPT, Claude or Gemini conversation, or <button className="underline hover:text-slate-300" onClick={() => setManual(true)}>paste a conversation manually</button>.</p>
          )}
        </div>
      )}

      {error && (
        <Notice tone="error" title={error.title} onDismiss={() => setError(null)}>
          <p>{error.text}</p>
          {error.canPaste && <p className="mt-1">Fallback: <button className="underline" onClick={() => setManual(true)}>paste the conversation text manually</button> (select all in the chat, copy, paste here).</p>}
        </Notice>
      )}

      {manual && (
        <div className="flex flex-col gap-2 bg-slate-800/50 border border-slate-700 rounded-md p-2.5">
          <Field label="Paste the conversation" hint='Lines like "You said:" / "ChatGPT said:" are used to detect speakers.'>
            <textarea rows={6} className={`${inputClass} font-mono text-xs`} value={pasted} onChange={e => setPasted(e.target.value)} />
          </Field>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setManual(false)}>Cancel</Button>
            <Button variant="primary" onClick={handlePasted} disabled={!pasted.trim() || busy}>Generate from pasted text</Button>
          </div>
        </div>
      )}

      {/* Extraction + generation summary */}
      {extraction && draft.result && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <Badge tone={extraction.complete ? 'ok' : 'warn'} title={extraction.complete ? 'No signs of missing messages were detected' : 'Some messages may be missing'}>
              {extraction.complete ? 'No gaps detected' : 'Partial / may be incomplete'}
            </Badge>
            <Badge>{extraction.messageCount} messages · {extraction.stats.user} user · {extraction.stats.assistant} AI</Badge>
            {extraction.stats.duplicatesRemoved > 0 && <Badge>{extraction.stats.duplicatesRemoved} duplicates removed</Badge>}
            {gen?.type === 'llm'
              ? <Badge tone="info" title={gen.model}>AI: {gen.provider}{gen.chunks > 1 ? ` · ${gen.chunks} chunks` : ''}</Badge>
              : <Badge tone="neutral" title={gen?.fallbackReason}>Basic (no AI)</Badge>}
          </div>
          {!extraction.complete && (
            <Notice tone="warn" title="This extraction may be incomplete">
              <ul className="list-disc ml-4">{extraction.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
              <p className="mt-1">The handoff says so explicitly, so the next AI will not treat it as the whole conversation.</p>
            </Notice>
          )}
          {gen?.type !== 'llm' && gen?.fallbackReason && (
            <p className="text-[11px] text-slate-500">Basic handoff: {gen.fallbackReason}. {settings.useBackendAI ? '' : 'Enable AI generation in Settings for a smarter summary.'}</p>
          )}
        </div>
      )}

      {status && <Notice tone={status.tone} onDismiss={() => setStatus(null)}>{status.text}</Notice>}

      {/* Preview / edit / inspect */}
      {draft.result && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-1 text-xs border-b border-slate-800">
            {[['preview', 'Preview'], ['edit', 'Edit'], ['messages', `Source messages (${extraction?.messageCount ?? 0})`]].map(([id, label]) => (
              <button key={id} onClick={() => setView(id)}
                className={`px-2.5 py-1.5 -mb-px border-b-2 ${view === id ? 'border-indigo-500 text-slate-100' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
                {label}
              </button>
            ))}
            {draft.edited && <span className="ml-auto self-center"><Badge tone="info">edited</Badge></span>}
          </div>

          {view === 'preview' && (
            <pre className="bg-slate-950 border border-slate-800 rounded-md p-2.5 text-[11px] leading-relaxed text-slate-300 whitespace-pre-wrap break-words max-h-64 overflow-y-auto font-mono">{markdown}</pre>
          )}
          {view === 'edit' && (
            <textarea className={`${inputClass} font-mono text-[11px] leading-relaxed h-64 resize-y`} value={markdown}
              onChange={e => update({ markdown: e.target.value, edited: true })} aria-label="Edit handoff Markdown" />
          )}
          {view === 'messages' && extraction && <MessageInspector extraction={extraction} />}

          <p className="text-[10px] text-slate-500">{markdown.length.toLocaleString()} characters{parts.length > 1 ? ` · will be pasted in ${parts.length} parts (limit ${settings.maxPartChars.toLocaleString()} per part)` : ''}</p>

          <div className="grid grid-cols-2 gap-2">
            <Button onClick={() => handleCopy()}>Copy Handoff</Button>
            <Button onClick={() => downloadMarkdown(draft.projectName || draft.title, markdown)}>Export Markdown</Button>
          </div>

          {phase !== 'continue' && (
            <div className="flex flex-col gap-2 border-t border-slate-800 pt-3">
              <Field label="Title">
                <input className={inputClass} value={draft.title || ''} onChange={e => update({ title: e.target.value })} />
              </Field>
              <Field label="Save to">
                <select className={inputClass} value={draft.targetId || ''} onChange={e => update({ targetId: e.target.value || null })}>
                  <option value="">New handoff</option>
                  {existing.map(h => <option key={h.id} value={h.id}>Update: {h.title}{h.projectName ? ` (${h.projectName})` : ''}</option>)}
                </select>
              </Field>
              <Button variant="primary" size="lg" onClick={handleSaveAndContinue} disabled={busy || !markdown.trim()}>Save Context &amp; Continue</Button>
            </div>
          )}
        </div>
      )}

      {/* Continue in a new chat */}
      {phase === 'continue' && (
        <div className="flex flex-col gap-2 border-t border-slate-800 pt-3">
          <p className="text-sm font-semibold text-slate-200">Continue in a new conversation</p>
          <ol className="text-xs text-slate-400 list-decimal ml-4 space-y-0.5">
            <li>Open a new chat below (this popup will close; your handoff stays saved).</li>
            <li>Paste with <kbd className="bg-slate-800 px-1 rounded">Ctrl</kbd>+<kbd className="bg-slate-800 px-1 rounded">V</kbd>, or reopen this popup and use “Insert into chat”.</li>
            <li>Review and press Send yourself — nothing is sent automatically.</li>
          </ol>
          <div className="grid grid-cols-3 gap-2">
            {Object.values(PLATFORMS).map(p => <Button key={p.id} variant={p.id === platform?.id ? 'primary' : 'secondary'} onClick={() => openNewChat(p)}>New {p.name} chat</Button>)}
          </div>
          {platform && <Button onClick={handleInsert}>Insert into this tab's chat box</Button>}
          <Button variant="ghost" onClick={() => setPhase('review')}>Back to editing</Button>
        </div>
      )}

      {parts.length > 1 && draft.result && (
        <div className="flex flex-col gap-1.5 border-t border-slate-800 pt-3">
          <p className="text-xs text-slate-300 font-medium">Too long for one message — paste these in order:</p>
          <Button onClick={() => handleCopy(buildPartsIndex(parts, draft.projectName || draft.title), 'Master index')}>Copy master index</Button>
          <div className="grid grid-cols-3 gap-1.5">
            {parts.map(p => <Button key={p.index} onClick={() => handleCopy(p.content, `Part ${p.index}/${p.total}`)}>Part {p.index}/{p.total}</Button>)}
          </div>
        </div>
      )}
    </div>
  );
}
