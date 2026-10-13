import { useEffect, useState } from 'react';
import { saveSettings, getClientToken, setClientToken, apiFetch, CONSENT_VERSION } from '../../../lib/settings.js';
import { Badge, Button, Field, Notice, Spinner, inputClass } from './ui';

function Toggle({ checked, onChange, label, children }) {
  return (
    <label className="flex gap-2.5 items-start cursor-pointer">
      <input type="checkbox" className="mt-0.5 accent-indigo-500" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm text-slate-200">{label}</span>
        <span className="text-[11px] text-slate-500 leading-relaxed">{children}</span>
      </span>
    </label>
  );
}

export default function SettingsView({ settings, onChange }) {
  const [apiBase, setApiBase] = useState(settings.apiBase);
  const [health, setHealth] = useState(null);
  const [checking, setChecking] = useState(false);
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [importValue, setImportValue] = useState('');
  const [status, setStatus] = useState(null);

  useEffect(() => { getClientToken().then(setToken); }, []);

  async function update(patch) {
    onChange(await saveSettings(patch));
  }

  async function enable(key, value, what) {
    if (value && !window.confirm(`${what}\n\nYou can turn this off at any time. Continue?`)) return;
    await update({ [key]: value, consentVersion: CONSENT_VERSION });
  }

  async function checkConnection() {
    setChecking(true);
    setHealth(null);
    try {
      const base = apiBase.trim().replace(/\/+$/, '');
      if (base !== settings.apiBase) await update({ apiBase: base });
      setHealth({ ok: true, ...(await apiFetch('/health', { timeoutMs: 8000, apiBase: base })) });
    } catch (err) {
      setHealth({ ok: false, error: err.message });
    } finally {
      setChecking(false);
    }
  }

  async function importToken() {
    try {
      await setClientToken(importValue.trim());
      setToken(importValue.trim().toLowerCase());
      setImportValue('');
      setStatus({ tone: 'ok', text: 'Access token replaced. Use Saved → Sync to download handoffs stored under it.' });
    } catch (err) {
      setStatus({ tone: 'error', text: err.message });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Privacy</h2>
        <p className="text-[11px] text-slate-500 leading-relaxed">
          By default everything stays in this browser: extraction, the basic handoff generator, and saved handoffs. The options below send data to the backend you configure.
        </p>
        <Toggle checked={settings.useBackendAI} label="AI-generated handoffs"
          onChange={v => enable('useBackendAI', v, 'When you click Extract Context, the extracted conversation will be sent to your backend, which forwards it to the LLM provider configured there (e.g. Gemini, OpenAI or Anthropic). The backend does not store or log the conversation.')}>
          Sends the extracted conversation to your backend and its LLM provider for a smarter summary. Falls back to the basic generator if unavailable.
        </Toggle>
        <Toggle checked={settings.syncToBackend} label="Sync saved handoffs to the backend"
          onChange={v => enable('syncToBackend', v, 'Saved handoffs (which contain parts of your conversations) will be stored in the backend\'s MongoDB database, scoped to this browser\'s access token.')}>
          Stores saved handoffs in MongoDB as a backup / for other devices. Local copies are always kept.
        </Toggle>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Backend</h2>
        <Field label="Backend URL" hint="Default http://localhost:4000. Use HTTPS for any non-local server.">
          <div className="flex gap-2">
            <input className={inputClass} value={apiBase} onChange={e => setApiBase(e.target.value)} onBlur={() => apiBase !== settings.apiBase && update({ apiBase })} />
            <Button onClick={checkConnection} disabled={checking}>{checking ? <Spinner /> : 'Test'}</Button>
          </div>
        </Field>
        {health && (health.ok ? (
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="ok">Connected</Badge>
            <Badge tone={health.db === 'connected' || health.db === 'memory' ? 'ok' : 'warn'}>DB: {health.db}</Badge>
            <Badge tone={health.llm?.configured ? 'ok' : 'warn'} title={health.llm?.reason}>{health.llm?.configured ? `LLM: ${health.llm.provider} (${health.llm.model})` : 'LLM: not configured'}</Badge>
            {!health.llm?.configured && <p className="text-[11px] text-slate-500 w-full">{health.llm?.reason} Handoffs will use the basic generator.</p>}
          </div>
        ) : <Notice tone="error">{health.error}</Notice>)}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Extraction</h2>
        <Toggle checked={settings.loadHistory} label="Load earlier messages automatically" onChange={v => update({ loadHistory: v })}>
          Scrolls the conversation to the top so older messages render before extraction. Turn off to read only what is already on the page (the handoff will be marked partial).
        </Toggle>
        <Field label="Default mode">
          <select className={inputClass} value={settings.defaultMode} onChange={e => update({ defaultMode: e.target.value })}>
            <option value="quick">Quick Summary</option>
            <option value="continue">Continue Project</option>
            <option value="full">Full Handoff</option>
            <option value="custom">Custom Handoff</option>
          </select>
        </Field>
        <Field label="Split handoffs longer than (characters)" hint="Long handoffs are split into numbered parts with a master index.">
          <input type="number" min={4000} max={500000} step={1000} className={inputClass} value={settings.maxPartChars}
            onChange={e => update({ maxPartChars: Math.max(4000, Number(e.target.value) || 30000) })} />
        </Field>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Access token</h2>
        <p className="text-[11px] text-slate-500 leading-relaxed">A random secret that identifies this browser to the backend. Only someone with this token can read your synced data — keep it private. Import it on another browser to share the same saved handoffs.</p>
        <div className="flex gap-2 items-center">
          <code className="text-[10px] bg-slate-950 border border-slate-800 rounded px-2 py-1.5 flex-1 truncate">{showToken ? token : '•'.repeat(32)}</code>
          <Button variant="ghost" onClick={() => setShowToken(s => !s)}>{showToken ? 'Hide' : 'Show'}</Button>
          <Button onClick={() => navigator.clipboard.writeText(token).then(() => setStatus({ tone: 'ok', text: 'Token copied.' }))}>Copy</Button>
        </div>
        <div className="flex gap-2">
          <input className={inputClass} placeholder="Paste a token to import" value={importValue} onChange={e => setImportValue(e.target.value)} />
          <Button onClick={importToken} disabled={!importValue.trim()}>Import</Button>
        </div>
        {status && <Notice tone={status.tone} onDismiss={() => setStatus(null)}>{status.text}</Notice>}
      </section>
    </div>
  );
}
