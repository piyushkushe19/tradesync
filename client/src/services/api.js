const BASE = import.meta.env.VITE_API_URL || '';

export class ApiError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request(path, { method = 'GET', params, signal } = {}) {
  const qs = params
    ? `?${new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString()}`
    : '';
  let res;
  try {
    res = await fetch(`${BASE}/api${path}${qs}`, { method, signal, headers: { Accept: 'application/json' } });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('Cannot reach the TradeSync API', { code: 'NETWORK' });
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    throw new ApiError(body?.error?.message || `Request failed (${res.status})`, {
      status: res.status,
      code: body?.error?.code,
      details: body?.error?.details,
    });
  }
  return body;
}

export const api = {
  getTrades: (params, signal) => request('/trades', { params, signal }),
  getStats: (signal) => request('/trades/stats', { signal }),
  getSyncStatus: (signal) => request('/sync/status', { signal }),
  getSyncJobs: (params, signal) => request('/sync/jobs', { params, signal }),
  startSync: () => request('/sync', { method: 'POST' }),
  eventsUrl: () => `${BASE}/api/events`,
};
