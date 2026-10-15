import { ArrowDown, ArrowUp, ArrowUpDown, DatabaseZap, SearchX } from 'lucide-react';
import Filters from './Filters.jsx';
import Pagination from './Pagination.jsx';
import { formatDateTime, formatInt, formatPrice } from '../utils/format.js';

const COLUMNS = [
  { key: 'tradeId', label: 'Trade ID', align: 'left' },
  { key: 'client', label: 'Client', align: 'left' },
  { key: 'symbol', label: 'Symbol', align: 'left' },
  { key: 'quantity', label: 'Quantity', align: 'right' },
  { key: 'price', label: 'Price', align: 'right' },
  { key: 'timestamp', label: 'Timestamp', align: 'right' },
];

function SortHeader({ col, query, onSort }) {
  const active = query.sortBy === col.key;
  const Icon = !active ? ArrowUpDown : query.sortOrder === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th scope="col" aria-sort={active ? (query.sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'} className={`px-4 py-2.5 font-medium ${col.align === 'right' ? 'text-right' : 'text-left'}`}>
      <button onClick={() => onSort(col.key)} className={`inline-flex items-center gap-1 hover:text-ink ${active ? 'text-ink' : ''}`}>
        {col.label} <Icon size={13} aria-hidden="true" />
      </button>
    </th>
  );
}

export default function TradesTable({ trades, query, symbols, onQuery, onRetry, onStartSync, syncBusy, totalStored }) {
  const { items, pagination, loading, error } = trades;
  const filtered = query.search || query.symbol || query.from || query.to;

  const onSort = (key) => onQuery({ sortBy: key, sortOrder: query.sortBy === key && query.sortOrder === 'desc' ? 'asc' : 'desc' });

  let body;
  if (loading && items.length === 0) {
    body = Array.from({ length: 8 }, (_, i) => (
      <tr key={i} className="border-t border-line">{COLUMNS.map((c) => <td key={c.key} className="px-4 py-3"><div className="skeleton h-4 w-full max-w-28" /></td>)}</tr>
    ));
  } else if (error && items.length === 0) {
    body = null;
  } else {
    body = items.map((t) => (
      <tr key={t.tradeId} className="border-t border-line hover:bg-canvas/60">
        <td className="num px-4 py-2.5">{t.tradeId}</td>
        <td className="num px-4 py-2.5">{t.client}</td>
        <td className="px-4 py-2.5 font-medium">{t.symbol}</td>
        <td className="num px-4 py-2.5 text-right">{formatInt(t.quantity)}</td>
        <td className="num px-4 py-2.5 text-right">{formatPrice(t.price)}</td>
        <td className="num px-4 py-2.5 text-right text-ink-soft">{formatDateTime(t.timestamp)}</td>
      </tr>
    ));
  }

  const empty = !loading && !error && items.length === 0;

  return (
    <section aria-label="Trades" className="rounded-xl border border-line bg-white shadow-[0_1px_2px_rgba(11,27,58,0.04)]">
      <div className="space-y-3 p-5 pb-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold">Trades</h2>
          <span className="text-xs text-ink-faint">{totalStored != null ? `${formatInt(totalStored)} stored` : ''}</span>
        </div>
        <Filters query={query} symbols={symbols} onChange={onQuery} />
      </div>

      {error && (
        <div role="alert" className="mx-5 mb-4 flex items-center justify-between rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
          <span>Could not load trades: {error}</span>
          <button onClick={onRetry} className="font-medium underline">Retry</button>
        </div>
      )}

      <div className={`overflow-x-auto transition-opacity ${loading && items.length ? 'opacity-60' : ''}`}>
        <table className="w-full min-w-176 text-sm">
          <thead className="bg-canvas/70 text-xs text-ink-soft">
            <tr>{COLUMNS.map((c) => <SortHeader key={c.key} col={c} query={query} onSort={onSort} />)}</tr>
          </thead>
          <tbody>{body}</tbody>
        </table>
      </div>

      {empty && !filtered && (
        <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <DatabaseZap size={28} className="text-ink-faint" aria-hidden="true" />
          <div>
            <p className="font-medium">No trades stored yet</p>
            <p className="text-sm text-ink-soft">Start a synchronization to pull trades from the exchange. You can leave this page open while it runs.</p>
          </div>
          <button onClick={onStartSync} disabled={syncBusy} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-[#1a43b8] disabled:bg-[#9fb3ec]">
            {syncBusy ? 'Sync in progress' : 'Start Sync'}
          </button>
        </div>
      )}
      {empty && filtered && (
        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <SearchX size={26} className="text-ink-faint" aria-hidden="true" />
          <p className="font-medium">No trades match these filters</p>
        </div>
      )}

      <Pagination pagination={pagination} onPage={(page) => onQuery({ page }, { resetPage: false })} onLimit={(limit) => onQuery({ limit })} />
    </section>
  );
}
