import { useEffect, useState } from 'react';
import { getSettings } from '../../lib/settings.js';
import { getActiveTab } from './lib/tabs';
import { detectPlatform } from './lib/platforms';
import { loadDraft, saveDraft } from './lib/store';
import HandoffView from './components/HandoffView';
import SavedView from './components/SavedView';
import SettingsView from './components/SettingsView';
import MemoriesView from './components/MemoriesView';

const TABS = [
  ['handoff', 'Handoff'],
  ['saved', 'Saved'],
  ['memories', 'Memories'],
  ['settings', 'Settings'],
];

export default function App() {
  const [tab, setTab] = useState('handoff');
  const [settings, setSettings] = useState(null);
  const [activeTab, setActiveTab] = useState(null);
  const [draft, setDraft] = useState(undefined);
  const [draftKey, setDraftKey] = useState(0);
  const [savedVersion, setSavedVersion] = useState(0);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    Promise.all([getSettings(), getActiveTab(), loadDraft()])
      .then(([s, t, d]) => { setSettings(s); setActiveTab(t); setDraft(d); })
      .catch(err => setLoadError(err.message));
  }, []);

  // "Update from current chat" on a saved handoff: start a draft that targets it.
  async function useForUpdate(record) {
    const next = { mode: record.mode || settings.defaultMode, projectName: record.projectName || '', customInstructions: '', targetId: record.id, title: record.title };
    await saveDraft(next);
    setDraft(next);
    setDraftKey(k => k + 1);
    setTab('handoff');
  }

  if (loadError) return <p className="p-4 text-sm text-red-400">Failed to start: {loadError}</p>;
  if (!settings || draft === undefined) return <p className="p-4 text-sm text-slate-500">Loading…</p>;

  const platform = detectPlatform(activeTab?.url);

  return (
    <div className="flex flex-col">
      <header className="px-4 pt-3 flex justify-between items-center">
        <h1 className="text-indigo-400 font-bold text-base">🧠 Context Memory</h1>
        <span className="text-[10px] text-slate-500">{settings.useBackendAI ? 'AI via backend' : 'Local mode'}</span>
      </header>
      <nav className="px-4 mt-2 flex gap-1 border-b border-slate-800" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`text-xs px-3 py-2 -mb-px border-b-2 transition-colors ${tab === id ? 'border-indigo-500 text-slate-100' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
            {label}
          </button>
        ))}
      </nav>
      <main className="p-4">
        {/* Kept mounted (hidden) so switching tabs never loses the working draft. */}
        <div hidden={tab !== 'handoff'}>
          <HandoffView key={draftKey} settings={settings} tab={activeTab} platform={platform} initialDraft={draft}
            onSaved={() => setSavedVersion(v => v + 1)} />
        </div>
        {tab === 'saved' && <SavedView settings={settings} onUseForUpdate={useForUpdate} refreshKey={savedVersion} />}
        {tab === 'memories' && <MemoriesView />}
        {tab === 'settings' && <SettingsView settings={settings} onChange={s => setSettings(s)} />}
      </main>
      {tab === 'handoff' && !settings.useBackendAI && !draft?.result && (
        <p className="px-4 pb-3 text-[10px] text-slate-500">
          Local mode: nothing leaves your browser. <button className="underline" onClick={() => setTab('settings')}>Enable AI generation</button> for smarter handoffs.
        </p>
      )}
    </div>
  );
}
