import { useState } from 'react';

const CATEGORIES = ['project', 'skill', 'goal', 'note'];

export default function AddForm({ onSave }) {
  const [form, setForm] = useState({ title: '', content: '', category: 'project', tags: '' });

  function handleSave() {
    if (!form.title.trim() || !form.content.trim()) return;
    onSave({
      ...form,
      tags: form.tags.split(',').map(t => t.trim()).filter(Boolean)
    });
  }

  return (
    <div className="flex flex-col gap-2.5">
      <select
        value={form.category}
        onChange={e => setForm({ ...form, category: e.target.value })}
        className="bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm outline-none"
      >
        {CATEGORIES.map(c => (
          <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
        ))}
      </select>

      <input
        placeholder="Title"
        value={form.title}
        onChange={e => setForm({ ...form, title: e.target.value })}
        className="bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm outline-none placeholder:text-slate-500"
      />

      <textarea
        placeholder="Content / details..."
        value={form.content}
        onChange={e => setForm({ ...form, content: e.target.value })}
        rows={5}
        className="bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm outline-none placeholder:text-slate-500 resize-y"
      />

      <input
        placeholder="Tags (comma separated)"
        value={form.tags}
        onChange={e => setForm({ ...form, tags: e.target.value })}
        className="bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm outline-none placeholder:text-slate-500"
      />

      <button
        onClick={handleSave}
        className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium py-2 rounded-md transition-colors"
      >
        Save Memory
      </button>
    </div>
  );
}