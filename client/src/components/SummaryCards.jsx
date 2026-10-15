import { formatCompactInr, formatDuration, formatInt } from '../utils/format.js';
import StatusBadge from './StatusBadge.jsx';

function Card({ label, children, hint, loading }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(11,27,58,0.04)]">
      <p className="text-sm text-ink-soft">{label}</p>
      <div className="mt-2 min-h-8 text-2xl font-semibold tracking-tight">
        {loading ? <div className="skeleton h-7 w-28" /> : children}
      </div>
      {hint && !loading && <p className="mt-1 text-xs text-ink-faint">{hint}</p>}
    </div>
  );
}

export default function SummaryCards({ stats, loading }) {
  const last = stats?.latestSuccessfulSync;
  const current = stats?.currentSync;
  return (
    <section aria-label="Summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Card label="Total trades" loading={loading} hint={stats ? `Notional ${formatCompactInr(stats.totalValue)}` : null}>
        <span className="num">{formatInt(stats?.totalTrades)}</span>
      </Card>
      <Card label="Distinct symbols" loading={loading}><span className="num">{formatInt(stats?.distinctSymbols)}</span></Card>
      <Card label="Total traded quantity" loading={loading} hint="Shares across all trades">
        <span className="num">{formatInt(stats?.totalQuantity)}</span>
      </Card>
      <Card label="Latest synchronization" loading={loading} hint={last ? `Last success took ${formatDuration(last.durationMs)}` : 'No successful sync yet'}>
        {current ? <StatusBadge status={current.status} /> : <span className="text-base font-medium text-ink-faint">Never run</span>}
      </Card>
    </section>
  );
}
