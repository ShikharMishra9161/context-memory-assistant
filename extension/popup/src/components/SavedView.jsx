import { useEffect, useState } from 'react';
import { listHandoffs, saveHandoff, deleteHandoff, duplicateHandoff, syncAll, syncOne } from '../lib/store';
import { copyText, downloadMarkdown } from '../lib/files';
import { PLATFORMS } from '../lib/platforms';
import { openNewChat } from '../lib/tabs';
import { Badge, Button, Field, Notice, Spinner, inputClass } from './ui';

const MODE_LABELS = { quick: 'Quick', continue: 'Continue', full: 'Full', custom: 'Custom' };

function SyncBadge({ h, enabled }) {
  if (!enabled) return null;
  if (h.syncState === 'synced') return <Badge tone="ok">synced</Badge>;
  if (h.syncState === 'error') return <Badge tone="error" title={h.syncError}>sync failed</Badge>;
  return <Badge>local only</Badge>;
}

function Detail({ record, settings, onBack, onChanged, onUseForUpdate }) {
  const [form, setForm] = useState({ title: record.title, projectName: record.projectName || '', markdown: record.markdown });
  const [status, setStatus] = useState(null);
  const dirty = form.title !== record.title || form.projectName !== (record.projectName || '') || form.markdown !== record.markdown;

  async function save() {
    if (!form.title.trim()) { setStatus({ tone: 'error', text: 'Title cannot be empty.' }); return; }
    const saved = await saveHandoff({ id: record.id, title: form.title.trim(), projectName: form.projectName.trim(), markdown: form.markdown });
    setStatus(saved.syncState === 'error' ? { tone: 'warn', text: `Saved locally. Server sync failed: ${saved.syncError}` } : { tone: 'ok', text: 'Saved.' });
    onChanged(saved);
  }

  async function copy() {
    const ok = await copyText(form.markdown);
    setStatus(ok ? { tone: 'ok', text: 'Copied. Open a new chat and paste it.' } : { tone: 'error', text: 'Clipboard access failed — select the text and copy manually.' });
  }

  async function remove() {
    if (!window.confirm(`Delete “${record.title}”? This cannot be undone.`)) return;
    await deleteHandoff(record.id);
    onBack(true);
  }

  async function duplicate() {
    const copy = await duplicateHandoff(record.id);
    onChanged(copy, true);
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => onBack(false)}>← All handoffs</Button>
        <div className="flex gap-1.5 items-center">
          {!record.complete && <Badge tone="warn">partial</Badge>}
          <SyncBadge h={record} enabled={settings.syncToBackend} />
        </div>
      </div>
      <Field label="Title"><input className={inputClass} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></Field>
      <Field label="Project"><input className={inputClass} value={form.projectName} onChange={e => setForm({ ...form, projectName: e.target.value })} /></Field>
      <Field label="Handoff (Markdown)">
        <textarea className={`${inputClass} font-mono text-[11px] h-56 resize-y`} value={form.markdown} onChange={e => setForm({ ...form, markdown: e.target.value })} />
      </Field>
      <p className="text-[10px] text-slate-500">
        {MODE_LABELS[record.mode] || record.mode} · {record.messageCount} messages · {record.platform || 'unknown platform'} · updated {new Date(record.updatedAt).toLocaleString()}
        {record.sourceUrl && <> · <a className="underline" href={record.sourceUrl} target="_blank" rel="noreferrer">source chat</a></>}
      </p>
      {status && <Notice tone={status.tone} onDismiss={() => setStatus(null)}>{status.text}</Notice>}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="primary" onClick={save} disabled={!dirty}>Save changes</Button>
        <Button onClick={copy}>Copy Handoff</Button>
        <Button onClick={() => downloadMarkdown(form.projectName || form.title, form.markdown)}>Export Markdown</Button>
        <Button onClick={duplicate}>Duplicate</Button>
        <Button onClick={() => onUseForUpdate(record)} title="Extract the current chat and save the result into this handoff">Update from current chat</Button>
        <Button variant="danger" onClick={remove}>Delete</Button>
      </div>
      {record.syncState === 'error' && settings.syncToBackend && (
        <Button onClick={async () => onChanged(await syncOne(record.id))}>Retry sync</Button>
      )}
      <div className="border-t border-slate-800 pt-2.5 flex flex-col gap-1.5">
        <p className="text-xs text-slate-400">Continue this project: copy the handoff, then open a new chat and paste it.</p>
        <div className="grid grid-cols-3 gap-2">
          {Object.values(PLATFORMS).map(p => (
            <Button key={p.id} onClick={async () => { await copyText(form.markdown); openNewChat(p); }}>Copy &amp; open {p.name}</Button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function SavedView({ settings, onUseForUpdate, refreshKey }) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState(null);
  const [selected, setSelected] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState(null);

  async function load(q = query) {
    setItems(await listHandoffs(q));
  }

  useEffect(() => {
    let cancelled = false;
    listHandoffs(query).then(list => { if (!cancelled) setItems(list); });
    return () => { cancelled = true; };
  }, [query, refreshKey]);

  async function sync() {
    setSyncing(true);
    setStatus(null);
    try {
      const r = await syncAll();
      setStatus({ tone: r.errors ? 'warn' : 'ok', text: `Sync finished: ${r.pushed} uploaded, ${r.pulled} downloaded${r.errors ? `, ${r.errors} failed (kept locally)` : ''}.` });
    } catch (err) {
      setStatus({ tone: 'error', text: `Sync failed: ${err.message}. Your handoffs are still saved locally.` });
    } finally {
      setSyncing(false);
      load();
    }
  }

  if (selected) {
    return (
      <Detail
        key={selected.id + selected.version}
        record={selected}
        settings={settings}
        onBack={() => { setSelected(null); load(); }}
        onChanged={(rec, open) => { if (rec) setSelected(rec); if (open) setStatus({ tone: 'ok', text: 'Duplicated.' }); load(); }}
        onUseForUpdate={onUseForUpdate}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex gap-2">
        <input className={inputClass} placeholder="Search title, project or content…" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search saved handoffs" />
        {settings.syncToBackend && <Button onClick={sync} disabled={syncing} title="Upload unsynced handoffs and download ones saved from elsewhere">{syncing ? <Spinner /> : '↺'} Sync</Button>}
      </div>
      {status && <Notice tone={status.tone} onDismiss={() => setStatus(null)}>{status.text}</Notice>}
      {items === null ? (
        <p className="text-xs text-slate-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-slate-500 text-sm text-center mt-8">{query ? 'No handoffs match your search.' : 'No saved handoffs yet. Extract a conversation and click “Save Context & Continue”.'}</p>
      ) : (
        <ul className="flex flex-col gap-1.5 max-h-[400px] overflow-y-auto pr-0.5">
          {items.map(h => (
            <li key={h.id}>
              <button className="w-full text-left bg-slate-800 hover:bg-slate-700/80 rounded-lg p-2.5 border-l-2 border-indigo-500 transition-colors" onClick={() => setSelected(h)}>
                <div className="flex justify-between gap-2">
                  <span className="font-semibold text-[13px] leading-tight truncate">{h.title}</span>
                  <span className="text-[10px] text-slate-500 shrink-0">{new Date(h.updatedAt).toLocaleDateString()}</span>
                </div>
                <div className="flex flex-wrap gap-1 mt-1.5 items-center">
                  {h.projectName && <Badge tone="info">{h.projectName}</Badge>}
                  <Badge>{MODE_LABELS[h.mode] || h.mode}</Badge>
                  <Badge>{h.messageCount} msgs</Badge>
                  {!h.complete && <Badge tone="warn">partial</Badge>}
                  <SyncBadge h={h} enabled={settings.syncToBackend} />
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
