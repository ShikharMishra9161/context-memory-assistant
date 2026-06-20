import { useState, useEffect, useCallback } from 'react';
import MemoryCard from './MemoryCard';

const CATEGORIES = ['project', 'skill', 'goal', 'note'];
const CAT_COLORS = {
  all: 'bg-slate-600', project: 'bg-indigo-600',
  skill: 'bg-emerald-600', goal: 'bg-amber-600', note: 'bg-slate-500'
};

export default function MemoryList({ memories, filter, setFilter, onDelete }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null); // null = show all
  const [searching, setSearching] = useState(false);

  // Debounced semantic search
  useEffect(() => {
    if (!query.trim()) { setResults(null); return; }
    const timer = setTimeout(async () => {
      setSearching(true);
      const { memories: found } = await chrome.runtime.sendMessage({
        type: 'SEARCH_MEMORIES', query, topK: 10
      });
      setResults(found || []);
      setSearching(false);
    }, 500); // 500ms debounce
    return () => clearTimeout(timer);
  }, [query]);

  const display = results !== null
    ? results
    : (filter === 'all' ? memories : memories.filter(m => m.category === filter));

  return (
    <div className="flex flex-col gap-3">
      {/* Search bar */}
      <div className="relative">
        <input
          placeholder="🔍 Search memories semantically..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm outline-none placeholder:text-slate-500 pr-8"
        />
        {searching && (
          <span className="absolute right-2 top-2 text-slate-400 text-xs animate-pulse">...</span>
        )}
        {query && !searching && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-2 top-2 text-slate-500 hover:text-slate-300 text-xs"
          >✕</button>
        )}
      </div>

      {/* Filter tabs — hide during search */}
      {!query && (
        <div className="flex gap-1.5 flex-wrap">
          {['all', ...CATEGORIES].map(cat => (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              className={`text-[11px] px-2.5 py-1 rounded-md transition-colors font-medium
                ${filter === cat ? CAT_COLORS[cat] : 'bg-slate-800 hover:bg-slate-700'}`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Results label during search */}
      {query && results !== null && (
        <p className="text-[11px] text-slate-500">
          {results.length} relevant {results.length === 1 ? 'memory' : 'memories'} found
        </p>
      )}

      {/* Cards */}
      <div className="flex flex-col gap-2 max-h-[320px] overflow-y-auto pr-0.5">
        {display.length === 0 ? (
          <p className="text-slate-500 text-sm text-center mt-10">
            {query ? 'No relevant memories found.' : 'No memories yet. Hit + Add.'}
          </p>
        ) : (
          display.map(m => (
            <MemoryCard
              key={m._id}
              memory={m}
              onDelete={onDelete}
              score={m.score} // show similarity score if present
            />
          ))
        )}
      </div>
    </div>
  );
}