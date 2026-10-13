import { useState, useEffect } from 'react';
import MemoryList from './MemoryList';
import AddForm from './AddForm';
import { apiFetch } from '../../../lib/settings.js';

// The original memory manager (saved notes injected with the on-page
// "Inject Context" button). Behaviour is unchanged; it moved out of App.jsx.
export default function MemoriesView() {
  const [memories, setMemories] = useState([]);
  const [view, setView] = useState('list');
  const [editingMemory, setEditingMemory] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_MEMORIES' })
      .then(res => setMemories(res?.memories || []))
      .catch(err => {
        setError('Could not load memories. Is the backend running?');
        console.error(err);
      });
  }, []);

  async function sync() {
    setSyncing(true);
    setError('');
    try {
      const res = await chrome.runtime.sendMessage({ type: 'SYNC_MEMORIES' });
      if (res?.error) throw new Error(res.error);
      setMemories(res?.memories || []);
    } catch (err) {
      setError(`Sync failed: ${err.message}`);
      console.error(err);
    } finally {
      setSyncing(false);
    }
  }

  async function handleSave(data) {
    setError('');
    try {
      const res = editingMemory
        ? await chrome.runtime.sendMessage({ type: 'UPDATE_MEMORY', id: editingMemory._id, payload: data })
        : await chrome.runtime.sendMessage({ type: 'SAVE_MEMORY', payload: data });

      if (res?.error || res?.success === false) {
        throw new Error(res?.error || 'Save failed');
      }

      setMemories(res?.memories || []);
      setEditingMemory(null);
      setView('list');
    } catch (err) {
      setError(err.message || 'Failed to save memory.');
      console.error(err);
    }
  }

  async function handleDelete(id) {
    setError('');
    try {
      const res = await chrome.runtime.sendMessage({ type: 'DELETE_MEMORY', id });
      if (res?.error || res?.success === false) {
        throw new Error(res?.error || 'Delete failed');
      }
      setMemories(res?.memories || memories.filter(m => m._id !== id));
    } catch (err) {
      setError(err.message || 'Failed to delete memory.');
      console.error(err);
    }
  }

  // Memories saved before per-install tokens belong to no one; the server must
  // opt in (ALLOW_LEGACY_MEMORY_CLAIM=true) before this browser can take them over.
  async function claimLegacy() {
    setError('');
    setNotice('');
    try {
      const { claimed } = await apiFetch('/memory/claim-legacy', { method: 'POST' });
      setNotice(claimed ? `Recovered ${claimed} older memories.` : 'No older memories left to recover.');
      if (claimed) await sync();
    } catch (err) {
      setError(err.status === 403
        ? 'Recovery is disabled on the server. Set ALLOW_LEGACY_MEMORY_CLAIM=true in backend/.env, restart, click again, then set it back to false.'
        : `Recovery failed: ${err.message}`);
    }
  }

  function goBack() {
    setEditingMemory(null);
    setView('list');
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-between items-center">
        <p className="text-[11px] text-slate-500">Reusable notes inserted with the on-page “Inject Context” button. Stored on the backend.</p>
        <div className="flex gap-2 shrink-0">
          <button onClick={sync} disabled={syncing}
            className="text-xs bg-slate-700 hover:bg-slate-600 disabled:opacity-50 px-3 py-1.5 rounded-md transition-colors">
            {syncing ? '⟳' : '↺'} Sync
          </button>
          <button onClick={() => (view === 'add' ? goBack() : (setEditingMemory(null), setView('add')))}
            className="text-xs bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 rounded-md transition-colors">
            {view === 'add' ? '← Back' : '+ Add'}
          </button>
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-400 bg-red-950/40 border border-red-900/50 rounded-md px-3 py-2">{error}</p>
      )}

      {notice && (
        <p className="text-xs text-emerald-300 bg-emerald-950/40 border border-emerald-900/50 rounded-md px-3 py-2">{notice}</p>
      )}

      {view === 'add' ? (
        <AddForm key={editingMemory?._id || 'new'} initial={editingMemory} onSave={handleSave} />
      ) : (
        <MemoryList
          memories={memories}
          filter={filter}
          setFilter={setFilter}
          onDelete={handleDelete}
          onEdit={m => { setEditingMemory(m); setView('add'); }}
        />
      )}

      <p className="text-[10px] text-slate-600 text-center">
        {memories.length} memories saved · <button className="underline hover:text-slate-400" onClick={claimLegacy}
          title="Memories created before this version are not linked to this browser yet">Recover older memories</button>
      </p>
    </div>
  );
}
