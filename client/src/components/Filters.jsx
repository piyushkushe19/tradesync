import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';

const field = 'h-9 rounded-md border border-line bg-white px-2.5 text-sm text-ink focus-visible:outline-2 focus-visible:outline-brand';

export default function Filters({ query, symbols, onChange }) {
  const [search, setSearch] = useState(query.search);

  // Debounce typing so we do not hit the API on every keystroke.
  useEffect(() => {
    if (search === query.search) return undefined;
    const t = setTimeout(() => onChange({ search }), 300);
    return () => clearTimeout(t);
  }, [search, query.search, onChange]);

  const dirty = query.search || query.symbol || query.from || query.to;
  const toIso = (date, end) => (date ? new Date(`${date}T${end ? '23:59:59.999' : '00:00:00.000'}`).toISOString() : '');
  const toDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-CA') : '');

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="relative block min-w-52 flex-1">
        <span className="sr-only">Search trades</span>
        <Search size={15} className="pointer-events-none absolute left-2.5 top-2.5 text-ink-faint" aria-hidden="true" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search trade ID, client or symbol" className={`${field} w-full pl-8`} />
      </label>
      <label className="text-xs text-ink-soft">
        Symbol
        <select value={query.symbol} onChange={(e) => onChange({ symbol: e.target.value })} className={`${field} mt-1 block w-36`}>
          <option value="">All symbols</option>
          {symbols.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <label className="text-xs text-ink-soft">
        From
        <input type="date" value={toDate(query.from)} onChange={(e) => onChange({ from: toIso(e.target.value, false) })} className={`${field} mt-1 block`} />
      </label>
      <label className="text-xs text-ink-soft">
        To
        <input type="date" value={toDate(query.to)} onChange={(e) => onChange({ to: toIso(e.target.value, true) })} className={`${field} mt-1 block`} />
      </label>
      {dirty && (
        <button onClick={() => { setSearch(''); onChange({ search: '', symbol: '', from: '', to: '' }); }} className="inline-flex h-9 items-center gap-1 rounded-md px-2 text-sm text-ink-soft hover:bg-canvas">
          <X size={14} aria-hidden="true" /> Clear
        </button>
      )}
    </div>
  );
}
