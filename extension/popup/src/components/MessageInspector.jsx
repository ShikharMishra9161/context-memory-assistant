import { useState } from 'react';
import { Badge } from './ui';

const ROLE_TONE = { user: 'info', assistant: 'ok', unknown: 'warn', system: 'neutral' };

/** Lets the user check exactly which messages were extracted before finalizing. */
export default function MessageInspector({ extraction }) {
  const [open, setOpen] = useState(null);
  const { messages, stats } = extraction;

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[11px] text-slate-500">
        {stats.count} kept of {stats.received} found · {stats.duplicatesRemoved} duplicates removed · {stats.emptySkipped} empty skipped · {stats.characters.toLocaleString()} characters
      </p>
      <ol className="flex flex-col gap-1 max-h-64 overflow-y-auto pr-0.5">
        {messages.map(m => {
          const expanded = open === m.index;
          return (
            <li key={m.index} className="bg-slate-800/70 rounded-md px-2 py-1.5">
              <button className="w-full text-left" onClick={() => setOpen(expanded ? null : m.index)} aria-expanded={expanded}>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-slate-500 w-6">#{m.index + 1}</span>
                  <Badge tone={ROLE_TONE[m.role]}>{m.role}</Badge>
                  {m.codeBlocks.length > 0 && <Badge>{m.codeBlocks.length} code</Badge>}
                  <span className="text-[10px] text-slate-500 ml-auto">{m.text.length.toLocaleString()} chars</span>
                </div>
                {!expanded && <p className="text-[11px] text-slate-400 mt-0.5 truncate">{m.text.replace(/\s+/g, ' ').slice(0, 140)}</p>}
              </button>
              {expanded && <pre className="text-[11px] text-slate-300 whitespace-pre-wrap break-words mt-1 max-h-48 overflow-y-auto font-mono">{m.text}</pre>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
