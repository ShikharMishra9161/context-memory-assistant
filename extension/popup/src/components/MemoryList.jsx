import MemoryCard from './MemoryCard';

const CATEGORIES = ['project', 'skill', 'goal', 'note'];
const CAT_COLORS = {
  all: 'bg-slate-600',
  project: 'bg-indigo-600',
  skill: 'bg-emerald-600',
  goal: 'bg-amber-600',
  note: 'bg-slate-500',
};

const FILTER_LABELS = {
  all: 'All',
  project: 'Project',
  skill: 'Skill',
  goal: 'Goal',
  note: 'Note',
};

export default function MemoryList({ memories, filter, setFilter, onDelete, onEdit }) {
  const filtered = filter === 'all' ? memories : memories.filter(m => m.category === filter);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1.5 flex-wrap">
        {['all', ...CATEGORIES].map(cat => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            className={`text-[11px] px-2.5 py-1 rounded-md transition-colors font-medium
              ${filter === cat ? CAT_COLORS[cat] : 'bg-slate-800 hover:bg-slate-700'}`}
          >
            {FILTER_LABELS[cat]}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2 max-h-[360px] overflow-y-auto pr-0.5">
        {filtered.length === 0 ? (
          <p className="text-slate-500 text-sm text-center mt-10">
            No memories yet. Click + Add Memory.
          </p>
        ) : (
          filtered.map(m => (
            <MemoryCard key={m._id} memory={m} onDelete={onDelete} onEdit={onEdit} />
          ))
        )}
      </div>
    </div>
  );
}
