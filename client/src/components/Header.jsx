import { RefreshCw, TrendingUp, Wifi, WifiOff } from 'lucide-react';
import { formatDateTime } from '../utils/format.js';

const CONNECTION = {
  open: { label: 'Live', cls: 'text-ok bg-ok-soft', Icon: Wifi },
  connecting: { label: 'Connecting…', cls: 'text-warn bg-warn-soft', Icon: Wifi },
  reconnecting: { label: 'Reconnecting…', cls: 'text-bad bg-bad-soft', Icon: WifiOff },
};

export default function Header({ connection, lastSyncAt, onRefresh }) {
  const c = CONNECTION[connection] ?? CONNECTION.connecting;
  return (
    <header className="border-b border-line bg-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-ink text-white"><TrendingUp size={18} aria-hidden="true" /></div>
          <div className="leading-tight">
            <h1 className="text-lg font-semibold tracking-tight">TradeSync</h1>
            <p className="text-xs text-ink-faint">BSE Mock Exchange</p>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3 text-sm">
          <span className="text-ink-soft">
            Last successful sync <span className="num ml-1 text-ink">{formatDateTime(lastSyncAt)}</span>
          </span>
          <span role="status" aria-live="polite" title="Server-Sent Events connection" className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${c.cls}`}>
            <c.Icon size={13} aria-hidden="true" /> {c.label}
          </span>
          <button onClick={onRefresh} className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium text-ink-soft hover:bg-canvas focus-visible:outline-2 focus-visible:outline-brand">
            <RefreshCw size={14} aria-hidden="true" /> Refresh
          </button>
        </div>
      </div>
    </header>
  );
}
