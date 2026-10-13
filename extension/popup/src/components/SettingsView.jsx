import { useEffect, useState } from 'react';
import { saveSettings, getClientToken, setClientToken, apiFetch, requestOriginAccess, CONSENT_VERSION } from '../../../lib/settings.js';
import { createLlmProvider, LLM_PROVIDERS } from '../../../../shared/handoff-core/index.js';
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

function Choice({ checked, onSelect, label, children }) {
  return (
    <label className={`flex gap-2.5 items-start cursor-pointer rounded-md border px-2.5 py-2 ${checked ? 'border-indigo-500 bg-indigo-950/30' : 'border-slate-800 hover:border-slate-700'}`}>
      <input type="radio" name="aiMode" className="mt-0.5 accent-indigo-500" checked={checked} onChange={onSelect} />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm text-slate-200">{label}</span>
        <span className="text-[11px] text-slate-500 leading-relaxed">{children}</span>
      </span>
    </label>
  );
}

const SectionTitle = ({ children }) => <h2 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">{children}</h2>;

export default function SettingsView({ settings, onChange }) {
  const [apiBase, setApiBase] = useState(settings.apiBase);
  const [byok, setByok] = useState(settings.byok);
  const [showKey, setShowKey] = useState(false);
  const [keyTest, setKeyTest] = useState(null);
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

  const confirmShare = what => window.confirm(`${what}\n\nYou can turn this off at any time. Continue?`);

  async function chooseAiMode(mode) {
    if (mode === settings.aiMode) return;
    if (mode === 'byok') {
      const label = LLM_PROVIDERS[byok.provider].label;
      if (!confirmShare(`When you click Extract Context, the extracted conversation will be sent directly from your browser to ${label} using your own API key. Their API terms and data policies apply.`)) return;
      await requestOriginAccess(LLM_PROVIDERS[byok.provider].origin);
    }
    if (mode === 'backend') {
      if (!confirmShare('When you click Extract Context, the extracted conversation will be sent to your backend, which forwards it to the LLM provider configured there. The backend does not store or log the conversation.')) return;
      await requestOriginAccess(settings.apiBase);
    }
    await update({ aiMode: mode, consentVersion: CONSENT_VERSION });
  }

  async function saveByok(patch) {
    const next = { ...byok, ...patch };
    setByok(next);
    setKeyTest(null);
    if (patch.provider && settings.aiMode === 'byok') await requestOriginAccess(LLM_PROVIDERS[patch.provider].origin);
    await update({ byok: next });
  }

  async function testKey() {
    setKeyTest({ running: true });
    const { provider, reason } = createLlmProvider({ ...byok, browser: true, timeoutMs: 30000 });
    if (!provider) { setKeyTest({ ok: false, text: reason }); return; }
    try {
      await requestOriginAccess(LLM_PROVIDERS[byok.provider].origin);
      await provider.generate({ system: 'Reply with JSON only.', prompt: 'Return {"ok": true}', maxTokens: 50 });
      setKeyTest({ ok: true, text: `Key works (${provider.model}).` });
    } catch (err) {
      const hint = err.code === 'AUTH' ? ' Check that the key is correct and active.' : err.code === 'RATE_LIMIT' ? ' Your quota or rate limit was hit.' : '';
      setKeyTest({ ok: false, text: `${err.message}${hint}` });
    }
  }

  async function toggleSync(value) {
    if (value) {
      if (!confirmShare('Saved handoffs (which contain parts of your conversations) will be stored in your backend\'s MongoDB database, scoped to this browser\'s access token.')) return;
      await requestOriginAccess(settings.apiBase);
    }
    await update({ syncToBackend: value, consentVersion: CONSENT_VERSION });
  }

  async function checkConnection() {
    setChecking(true);
    setHealth(null);
    try {
      const base = apiBase.trim().replace(/\/+$/, '');
      await requestOriginAccess(base);
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

  const providerInfo = LLM_PROVIDERS[byok.provider];
  const needsBackend = settings.aiMode === 'backend' || settings.syncToBackend;

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <SectionTitle>AI handoffs</SectionTitle>
        <p className="text-[11px] text-slate-500 leading-relaxed">
          Extraction always happens in your browser. Choose how the handoff is written:
        </p>
        <Choice checked={settings.aiMode === 'off'} onSelect={() => chooseAiMode('off')} label="Built-in (no AI)">
          Nothing leaves your browser. Copies code, errors, commands and your requirements verbatim; uses keyword matching for the rest.
        </Choice>
        <Choice checked={settings.aiMode === 'byok'} onSelect={() => chooseAiMode('byok')} label="Your own API key (recommended)">
          Smarter summaries using Gemini, OpenAI or Claude. The conversation goes straight from your browser to the provider — no server needed.
        </Choice>
        {settings.aiMode === 'byok' && (
          <div className="flex flex-col gap-2 ml-6">
            <Field label="Provider">
              <select className={inputClass} value={byok.provider} onChange={e => saveByok({ provider: e.target.value, model: '' })}>
                {Object.entries(LLM_PROVIDERS).map(([id, p]) => <option key={id} value={id}>{p.label}</option>)}
              </select>
            </Field>
            <Field label="API key" hint={<>Stored only in this browser. <a className="underline" href={providerInfo.keyUrl} target="_blank" rel="noreferrer">Get a {providerInfo.label} key</a></>}>
              <div className="flex gap-2">
                <input type={showKey ? 'text' : 'password'} className={inputClass} value={byok.apiKey} autoComplete="off" spellCheck={false}
                  placeholder="Paste your API key" onChange={e => setByok({ ...byok, apiKey: e.target.value })} onBlur={() => saveByok({ apiKey: byok.apiKey })} />
                <Button variant="ghost" onClick={() => setShowKey(s => !s)}>{showKey ? 'Hide' : 'Show'}</Button>
              </div>
            </Field>
            <Field label="Model (optional)" hint={`Default: ${providerInfo.defaultModel}`}>
              <input className={inputClass} value={byok.model} placeholder={providerInfo.defaultModel}
                onChange={e => setByok({ ...byok, model: e.target.value })} onBlur={() => saveByok({ model: byok.model.trim() })} />
            </Field>
            <div className="flex items-center gap-2">
              <Button onClick={testKey} disabled={!byok.apiKey || keyTest?.running}>{keyTest?.running ? <><Spinner /> Testing…</> : 'Test key'}</Button>
              {keyTest && !keyTest.running && <Badge tone={keyTest.ok ? 'ok' : 'error'}>{keyTest.ok ? 'Working' : 'Failed'}</Badge>}
            </div>
            {keyTest?.text && !keyTest.ok && <Notice tone="error">{keyTest.text}</Notice>}
            {keyTest?.ok && <p className="text-[11px] text-emerald-400">{keyTest.text}</p>}
          </div>
        )}
        <Choice checked={settings.aiMode === 'backend'} onSelect={() => chooseAiMode('backend')} label="Your own backend server">
          For developers running the included backend: it holds the API key and calls the LLM provider.
        </Choice>
      </section>

      <section className="flex flex-col gap-2">
        <SectionTitle>Saved handoffs</SectionTitle>
        <Toggle checked={settings.syncToBackend} label="Sync saved handoffs to your backend" onChange={toggleSync}>
          Stores saved handoffs in your backend's MongoDB as a backup / for other devices. Local copies are always kept. Requires the backend.
        </Toggle>
      </section>

      {needsBackend && (
        <section className="flex flex-col gap-2">
          <SectionTitle>Backend</SectionTitle>
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
              {!health.llm?.configured && <p className="text-[11px] text-slate-500 w-full">{health.llm?.reason}. Handoffs will use the built-in generator.</p>}
            </div>
          ) : <Notice tone="error">{health.error}</Notice>)}

          <p className="text-[11px] text-slate-500 leading-relaxed mt-1">
            <strong className="text-slate-400">Access token:</strong> a random secret identifying this browser to the backend. Only someone with it can read your synced data. Import it in another browser to share saved handoffs.
          </p>
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
      )}
      {!needsBackend && (
        <p className="text-[11px] text-slate-500">Running your own backend? Choose “Your own backend server” above or enable sync to configure it.</p>
      )}

      <section className="flex flex-col gap-2">
        <SectionTitle>Extraction</SectionTitle>
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
        <SectionTitle>Memories (advanced)</SectionTitle>
        <Toggle checked={settings.showInjectButton} label="Show the “Inject Context” button on AI chat pages" onChange={v => update({ showInjectButton: v })}>
          Adds a button that inserts your saved memories into the chat box. Memories require your own backend. Turning it on takes effect after reloading the chat tab.
        </Toggle>
      </section>
    </div>
  );
}
