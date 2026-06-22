import { useState, useEffect } from 'react';
import MemoryList from './components/MemoryList';
import AddForm from './components/AddForm';

export default function App() {
  const [memories, setMemories] = useState([]);
  const [view, setView] = useState('list');
  const [editingMemory, setEditingMemory] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');

  useEffect(() => { loadMemories(); }, []);

  async function loadMemories() {
    try {
      setError('');
      const res = await chrome.runtime.sendMessage({ type: 'GET_MEMORIES' });
      setMemories(res?.memories || []);
    } catch (err) {
      setError('Could not load memories. Is the backend running?');
      console.error(err);
    }
  }

  async function sync() {
    setSyncing(true);
    setError('');
    try {
      const res = await chrome.runtime.sendMessage({ type: 'SYNC_MEMORIES' });
      if (res?.error) throw new Error(res.error);
      setMemories(res?.memories || []);
    } catch (err) {
      setError('Sync failed. Start the backend on localhost:4000.');
      console.error(err);
    } finally {
      setSyncing(false);
    }
  }

  async function handleSave(data) {
    setError('');
    try {
      const res = editingMemory
        ? await chrome.runtime.sendMessage({
            type: 'UPDATE_MEMORY',
            id: editingMemory._id,
            payload: data,
          })
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

  function openAdd() {
    setEditingMemory(null);
    setView('add');
  }

  function openEdit(memory) {
    setEditingMemory(memory);
    setView('add');
  }

  function goBack() {
    setEditingMemory(null);
    setView('list');
  }

  return (
    <div className="p-4 flex flex-col gap-3">
      <div className="flex justify-between items-center">
        <h1 className="text-indigo-400 font-bold text-base">🧠 Context Memory</h1>
        <div className="flex gap-2">
          <button
            onClick={sync}
            disabled={syncing}
            className="text-xs bg-slate-700 hover:bg-slate-600 disabled:opacity-50 px-3 py-1.5 rounded-md transition-colors"
          >
            {syncing ? '⟳' : '↺'} Sync
          </button>
          <button
            onClick={() => (view === 'add' ? goBack() : openAdd())}
            className="text-xs bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 rounded-md transition-colors"
          >
            {view === 'add' ? '← Back' : '+ Add Memory'}
          </button>
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-400 bg-red-950/40 border border-red-900/50 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      {view === 'add' ? (
        <AddForm
          key={editingMemory?._id || 'new'}
          initial={editingMemory}
          onSave={handleSave}
        />
      ) : (
        <MemoryList
          memories={memories}
          filter={filter}
          setFilter={setFilter}
          onDelete={handleDelete}
          onEdit={openEdit}
        />
      )}

      <p className="text-[10px] text-slate-600 text-center">{memories.length} memories saved</p>
    </div>
  );
}
