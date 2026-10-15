import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatInt } from '../utils/format.js';

export default function Pagination({ pagination, onPage, onLimit }) {
  if (!pagination) return null;
  const { page, limit, total, totalPages } = pagination;
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  const btn = 'inline-flex h-8 w-8 items-center justify-center rounded-md border border-line bg-white text-ink-soft hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-40';
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-ink-soft">
      <span className="num">{formatInt(from)}–{formatInt(to)} of {formatInt(total)}</span>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2">
          Rows
          <select value={limit} onChange={(e) => onLimit(Number(e.target.value))} className="h-8 rounded-md border border-line bg-white px-1.5">
            {[10, 25, 50, 100].map((n) => <option key={n}>{n}</option>)}
          </select>
        </label>
        <div className="flex items-center gap-1.5">
          <button className={btn} onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page"><ChevronLeft size={16} /></button>
          <span className="num min-w-20 text-center">Page {page} / {totalPages}</span>
          <button className={btn} onClick={() => onPage(page + 1)} disabled={page >= totalPages} aria-label="Next page"><ChevronRight size={16} /></button>
        </div>
      </div>
    </div>
  );
}
