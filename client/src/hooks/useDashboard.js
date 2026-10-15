import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api.js';

export const DEFAULT_QUERY = { page: 1, limit: 25, search: '', symbol: '', sortBy: 'timestamp', sortOrder: 'desc', from: '', to: '' };

const upsertJob = (items, job) => {
  const idx = items.findIndex((j) => j.jobId === job.jobId);
  if (idx === -1) return [job, ...items].slice(0, 10);
  const next = items.slice();
  next[idx] = job;
  return next;
};

/**
 * All dashboard data. Every fetch here is triggered by: initial mount, a user action,
 * an SSE event, or an SSE reconnection. There are no timers or recurring requests.
 */
export function useDashboard({ notify }) {
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [trades, setTrades] = useState({ items: [], pagination: null, loading: true, error: null });
  const [stats, setStats] = useState({ data: null, loading: true, error: null });
  const [sync, setSync] = useState({ active: null, latest: null, lastSuccessful: null, loading: true });
  const [jobs, setJobs] = useState({ items: [], loading: true, error: null });
  const [starting, setStarting] = useState(false);

  const queryRef = useRef(query);
  const seq = useRef({ trades: 0, stats: 0, sync: 0, jobs: 0 });

  const loadTrades = useCallback(async ({ silent = false, q } = {}) => {
    const params = q ?? queryRef.current;
    const id = ++seq.current.trades;
    if (!silent) setTrades((s) => ({ ...s, loading: true, error: null }));
    try {
      const r = await api.getTrades(params);
      if (id === seq.current.trades) setTrades({ items: r.data, pagination: r.meta.pagination, loading: false, error: null });
    } catch (e) {
      if (id === seq.current.trades) setTrades((s) => ({ ...s, loading: false, error: e.message }));
    }
  }, []);

  const loadStats = useCallback(async () => {
    const id = ++seq.current.stats;
    try {
      const r = await api.getStats();
      if (id === seq.current.stats) setStats({ data: r.data, loading: false, error: null });
    } catch (e) {
      if (id === seq.current.stats) setStats((s) => ({ ...s, loading: false, error: e.message }));
    }
  }, []);

  const loadSync = useCallback(async () => {
    const id = ++seq.current.sync;
    try {
      const r = await api.getSyncStatus();
      if (id === seq.current.sync) setSync({ ...r.data, loading: false });
    } catch {
      if (id === seq.current.sync) setSync((s) => ({ ...s, loading: false }));
    }
  }, []);

  const loadJobs = useCallback(async () => {
    const id = ++seq.current.jobs;
    try {
      const r = await api.getSyncJobs({ limit: 8 });
      if (id === seq.current.jobs) setJobs({ items: r.data, loading: false, error: null });
    } catch (e) {
      if (id === seq.current.jobs) setJobs((s) => ({ ...s, loading: false, error: e.message }));
    }
  }, []);

  const refreshAll = useCallback(() => {
    loadTrades({ silent: true });
    loadStats();
    loadSync();
    loadJobs();
  }, [loadTrades, loadStats, loadSync, loadJobs]);

  // Initial data: independent requests, rendered as each one arrives. SSE is set up separately.
  useEffect(() => { loadStats(); loadSync(); loadJobs(); }, [loadStats, loadSync, loadJobs]);
  useEffect(() => { queryRef.current = query; loadTrades({ q: query }); }, [query, loadTrades]);

  const updateQuery = useCallback((patch, { resetPage = true } = {}) => {
    setQuery((q) => ({ ...q, ...patch, ...(resetPage ? { page: 1 } : {}) }));
  }, []);

  const handleEvent = useCallback((type, envelope) => {
    const job = envelope?.data?.job;
    switch (type) {
      case 'sync:queued':
      case 'sync:started':
      case 'sync:progress':
        if (job) {
          setSync((s) => ({ ...s, active: job, latest: job }));
          setJobs((s) => ({ ...s, items: upsertJob(s.items, job) }));
        }
        break;
      case 'sync:completed':
        if (job) {
          setSync((s) => ({ ...s, active: null, latest: job, lastSuccessful: job }));
          setJobs((s) => ({ ...s, items: upsertJob(s.items, job) }));
          notify('success', 'Synchronization complete', `${job.processedTradeCount.toLocaleString('en-IN')} trades processed (${job.insertedTradeCount.toLocaleString('en-IN')} new).`);
        }
        break;
      case 'sync:failed':
        if (job) {
          setSync((s) => ({ ...s, active: null, latest: job }));
          setJobs((s) => ({ ...s, items: upsertJob(s.items, job) }));
          notify('error', 'Synchronization failed', job.errorMessage || 'Unknown error');
        }
        loadStats();
        break;
      case 'trades:updated':
        loadTrades({ silent: true });
        loadStats();
        break;
      case 'resync':
        refreshAll();
        break;
      default:
    }
  }, [notify, loadTrades, loadStats, refreshAll]);

  const startSync = useCallback(async () => {
    setStarting(true);
    try {
      const r = await api.startSync();
      const { jobId, status, createdAt } = r.data;
      setSync((s) => (s.active?.jobId === jobId ? s : { ...s, active: { jobId, status, phase: 'queued', createdAt, processedTradeCount: 0 } }));
      notify('info', 'Sync queued', `Job ${jobId} accepted. You can keep using the dashboard.`);
    } catch (e) {
      if (e.status === 409) {
        notify('warning', 'Sync already running', 'Showing the active job.');
        loadSync();
      } else {
        notify('error', 'Could not start sync', e.message);
      }
    } finally {
      setStarting(false);
    }
  }, [notify, loadSync]);

  return { query, updateQuery, trades, loadTrades, stats, sync, jobs, starting, startSync, handleEvent, refreshAll };
}
