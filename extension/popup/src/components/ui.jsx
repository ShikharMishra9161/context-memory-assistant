// Small shared UI primitives in the popup's existing slate/indigo style.

const VARIANTS = {
  primary: 'bg-indigo-600 hover:bg-indigo-500 text-white',
  secondary: 'bg-slate-700 hover:bg-slate-600 text-slate-100',
  ghost: 'bg-transparent hover:bg-slate-800 text-slate-300',
  danger: 'bg-red-900/60 hover:bg-red-800 text-red-100',
  success: 'bg-emerald-600 hover:bg-emerald-500 text-white',
};

export function Button({ variant = 'secondary', size = 'sm', className = '', ...props }) {
  const sizes = { sm: 'text-xs px-3 py-1.5', md: 'text-sm px-4 py-2', lg: 'text-sm px-4 py-2.5 font-semibold' };
  return (
    <button
      type="button"
      className={`${VARIANTS[variant]} ${sizes[size]} rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      {...props}
    />
  );
}

const BADGES = {
  neutral: 'bg-slate-800 text-slate-300 border-slate-700',
  ok: 'bg-emerald-950/60 text-emerald-300 border-emerald-800',
  warn: 'bg-amber-950/60 text-amber-300 border-amber-800',
  error: 'bg-red-950/60 text-red-300 border-red-800',
  info: 'bg-indigo-950/60 text-indigo-300 border-indigo-800',
};

export function Badge({ tone = 'neutral', children, title }) {
  return <span title={title} className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${BADGES[tone]}`}>{children}</span>;
}

export function Notice({ tone = 'info', title, children, onDismiss }) {
  const tones = {
    info: 'text-indigo-200 bg-indigo-950/40 border-indigo-900/60',
    warn: 'text-amber-200 bg-amber-950/40 border-amber-900/60',
    error: 'text-red-300 bg-red-950/40 border-red-900/50',
    ok: 'text-emerald-200 bg-emerald-950/40 border-emerald-900/60',
  };
  return (
    <div className={`text-xs border rounded-md px-3 py-2 ${tones[tone]}`} role={tone === 'error' ? 'alert' : 'status'}>
      <div className="flex justify-between gap-2">
        <div className="min-w-0">
          {title && <p className="font-semibold mb-0.5">{title}</p>}
          <div className="leading-relaxed break-words">{children}</div>
        </div>
        {onDismiss && <button onClick={onDismiss} className="text-current opacity-60 hover:opacity-100 shrink-0" aria-label="Dismiss">✕</button>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-slate-400">{label}</span>
      {children}
      {hint && <span className="text-[10px] text-slate-500">{hint}</span>}
    </label>
  );
}

export const inputClass = 'bg-slate-800 border border-slate-700 focus:border-indigo-500 rounded-md px-3 py-2 text-sm outline-none placeholder:text-slate-500 w-full';

export function Spinner() {
  return <span className="inline-block w-3 h-3 border-2 border-current border-r-transparent rounded-full animate-spin align-[-2px]" aria-hidden="true" />;
}
