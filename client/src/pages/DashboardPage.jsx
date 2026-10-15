import Header from '../components/Header.jsx';
import SummaryCards from '../components/SummaryCards.jsx';
import SyncPanel from '../components/SyncPanel.jsx';
import SymbolChart from '../components/SymbolChart.jsx';
import TradesTable from '../components/TradesTable.jsx';
import SyncHistory from '../components/SyncHistory.jsx';
import ToastHost from '../components/ToastHost.jsx';
import { useDashboard } from '../hooks/useDashboard.js';
import { useEventSource } from '../hooks/useEventSource.js';
import { useToasts } from '../hooks/useToasts.js';
import { api } from '../services/api.js';

export default function DashboardPage() {
  const { toasts, notify, dismiss } = useToasts();
  const d = useDashboard({ notify });

  // Opened independently of the data requests above: the page renders immediately.
  const connection = useEventSource({ url: api.eventsUrl(), onEvent: d.handleEvent, onReconnect: d.refreshAll });

  const lastSyncAt = d.sync.lastSuccessful?.completedAt ?? d.stats.data?.latestSuccessfulSync?.completedAt;
  const syncBusy = Boolean(d.sync.active) || d.starting;

  return (
    <div className="min-h-screen">
      <Header connection={connection} lastSyncAt={lastSyncAt} onRefresh={d.refreshAll} />
      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
        {d.stats.error && !d.stats.data && (
          <p role="alert" className="rounded-lg bg-bad-soft px-4 py-3 text-sm text-bad">Cannot load dashboard statistics: {d.stats.error}</p>
        )}
        <SummaryCards stats={d.stats.data} loading={d.stats.loading} />
        <div className="grid gap-5 lg:grid-cols-3">
          <SyncPanel sync={d.sync} starting={d.starting} onStart={d.startSync} />
          <div className="lg:col-span-2"><SymbolChart data={d.stats.data?.topSymbols} loading={d.stats.loading} /></div>
        </div>
        <TradesTable
          trades={d.trades}
          query={d.query}
          symbols={d.stats.data?.symbols ?? []}
          totalStored={d.stats.data?.totalTrades}
          onQuery={d.updateQuery}
          onRetry={() => d.loadTrades()}
          onStartSync={d.startSync}
          syncBusy={syncBusy}
        />
        <SyncHistory jobs={d.jobs} />
      </main>
      <ToastHost toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
