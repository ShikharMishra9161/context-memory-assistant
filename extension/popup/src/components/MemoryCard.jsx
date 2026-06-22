const BORDER_COLORS = {
  project: 'border-indigo-500',
  skill: 'border-emerald-500',
  goal: 'border-amber-500',
  note: 'border-slate-500',
};

export default function MemoryCard({ memory: m, onDelete, onEdit }) {
  return (
    <div className={`bg-slate-800 rounded-lg p-3 border-l-2 ${BORDER_COLORS[m.category] || 'border-slate-500'}`}>
      <div className="flex justify-between items-start gap-2">
        <span className="font-semibold text-[13px] leading-tight">{m.title}</span>
        <div className="flex gap-1 shrink-0">
          <button
            onClick={() => onEdit(m)}
            className="text-slate-500 hover:text-indigo-400 transition-colors text-xs px-1"
            title="Edit"
          >
            ✎
          </button>
          <button
            onClick={() => onDelete(m._id)}
            className="text-slate-500 hover:text-red-400 transition-colors text-sm px-1"
            title="Delete"
          >
            ✕
          </button>
        </div>
      </div>
      <p className="text-[12px] text-slate-400 mt-1 leading-relaxed">
        {m.content.slice(0, 120)}{m.content.length > 120 ? '…' : ''}
      </p>
      {m.tags?.length > 0 && (
        <div className="flex gap-1 mt-2 flex-wrap">
          {m.tags.map(t => (
            <span key={t} className="text-[10px] bg-slate-900 text-slate-500 px-1.5 py-0.5 rounded">
              #{t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
