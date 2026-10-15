import { AlertTriangle, RefreshCcw } from 'lucide-react';
import StatusBadge from './StatusBadge.jsx';
import { formatDateTime, formatDuration, formatInt } from '../utils/format.js';

const PHASES = {
  queued: 'Waiting for a worker to pick up the job.',
  starting_exchange_pull: 'Asking the exchange to start a pull.',
  awaiting_exchange: 'The exchange is preparing the dataset. It reports no progress, so none is shown.',
  persisting: 'Saving pulled trades to the database.',
  retrying: 'A temporary error occurred; the worker will retry automatically.',
};

function Row({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="text-sm text-ink-soft">{label}</dt>
      <dd className="num text-right text-sm">{children}</dd>
    </div>
  );
}

export default function SyncPanel({ sync, starting, onStart }) {
  const job = sync.active ?? sync.latest;
  const busy = Boolean(sync.active) || starting;
  const last = sync.lastSuccessful;
  const expected = job?.expectedTradeCount;

  return (
    <section aria-label="Synchronization" className="rounded-xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(11,27,58,0.04)]">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Synchronization</h2>
        {job ? <StatusBadge status={job.status} /> : <span className="text-xs text-ink-faint">Idle</span>}
      </div>

      <button
        onClick={onStart}
        disabled={busy}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#1a43b8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:bg-[#9fb3ec]"
      >
        <RefreshCcw size={15} aria-hidden="true" />
        {starting ? 'Submitting…' : sync.active ? (sync.active.status === 'queued' ? 'Queued…' : 'Sync in progress') : 'Start Sync'}
      </button>

      {job?.phase && sync.active && <p className="mt-3 text-sm text-ink-soft">{PHASES[job.phase] ?? ''}</p>}

      {job?.status === 'failed' && (
        <div role="alert" className="mt-3 flex gap-2 rounded-lg bg-bad-soft p-3 text-sm text-bad">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{job.errorMessage || 'The synchronization failed.'}</span>
        </div>
      )}
      {job?.status === 'running' && job.errorMessage && (
        <p className="mt-3 rounded-lg bg-warn-soft p-3 text-sm text-warn">{job.errorMessage}</p>
      )}

      <dl className="mt-4 divide-y divide-line border-t border-line">
        <Row label="Job ID">{job?.jobId ?? '—'}</Row>
        <Row label="Started">{formatDateTime(job?.startedAt)}</Row>
        <Row label="Completed">{formatDateTime(job?.completedAt)}</Row>
        <Row label="Duration">{job?.completedAt ? formatDuration(job.durationMs) : job?.startedAt ? 'in progress' : '—'}</Row>
        <Row label="Processed">{job ? `${formatInt(job.processedTradeCount)}${expected ? ` / ${formatInt(expected)}` : ''}` : '—'}</Row>
        <Row label="Last successful">{last ? formatDateTime(last.completedAt) : '—'}</Row>
      </dl>
    </section>
  );
}
