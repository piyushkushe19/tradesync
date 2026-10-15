import StatusBadge from './StatusBadge.jsx';
import { formatDateTime, formatDuration, formatInt } from '../utils/format.js';

export default function SyncHistory({ jobs }) {
  const { items, loading, error } = jobs;
  return (
    <section aria-label="Synchronization history" className="rounded-xl border border-line bg-white shadow-[0_1px_2px_rgba(11,27,58,0.04)]">
      <div className="p-5 pb-3"><h2 className="text-base font-semibold">Synchronization history</h2></div>
      {error && <p role="alert" className="mx-5 mb-3 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">Could not load history: {error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-176 text-sm">
          <thead className="bg-canvas/70 text-xs text-ink-soft">
            <tr>{['Job ID', 'Status', 'Started', 'Completed', 'Duration', 'Processed', 'Details'].map((h, i) => (
              <th key={h} scope="col" className={`px-4 py-2.5 font-medium ${i >= 4 && i < 6 ? 'text-right' : 'text-left'}`}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {loading && items.length === 0 && Array.from({ length: 3 }, (_, i) => (
              <tr key={i} className="border-t border-line">{Array.from({ length: 7 }, (_, j) => <td key={j} className="px-4 py-3"><div className="skeleton h-4 w-20" /></td>)}</tr>
            ))}
            {items.map((j) => (
              <tr key={j.jobId} className="border-t border-line">
                <td className="num px-4 py-2.5">{j.jobId}</td>
                <td className="px-4 py-2.5"><StatusBadge status={j.status} /></td>
                <td className="num px-4 py-2.5 text-ink-soft">{formatDateTime(j.startedAt ?? j.createdAt)}</td>
                <td className="num px-4 py-2.5 text-ink-soft">{formatDateTime(j.completedAt)}</td>
                <td className="num px-4 py-2.5 text-right">{j.completedAt ? formatDuration(j.durationMs) : '—'}</td>
                <td className="num px-4 py-2.5 text-right">{formatInt(j.processedTradeCount)}</td>
                <td className="max-w-72 truncate px-4 py-2.5 text-ink-soft" title={j.errorMessage ?? ''}>
                  {j.status === 'failed' ? <span className="text-bad">{j.errorMessage}</span> : j.status === 'completed' ? `${formatInt(j.insertedTradeCount)} new · ${formatInt(j.updatedTradeCount)} existing` : ''}
                </td>
              </tr>
            ))}
            {!loading && !error && items.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-ink-faint">No synchronizations have run yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
