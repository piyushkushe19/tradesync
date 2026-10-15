import { env } from '../config/env.js';
import { ExchangeError } from '../utils/errors.js';

/** Thin client for the mock exchange. Every call is short-lived and has a hard timeout (<30s). */
export function createExchangeClient({ baseUrl = env.EXCHANGE_URL, timeoutMs = env.EXCHANGE_HTTP_TIMEOUT_MS } = {}) {
  async function call(path, init) {
    let res;
    try {
      res = await fetch(`${baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      throw new ExchangeError(`Exchange unreachable (${err.name === 'TimeoutError' ? 'timeout' : err.cause?.code || err.message})`, { retryable: true });
    }
    if (res.status === 404) throw new ExchangeError('Exchange operation not found', { retryable: false, status: 404 });
    if (!res.ok) throw new ExchangeError(`Exchange responded with HTTP ${res.status}`, { retryable: res.status >= 500, status: res.status });
    try {
      return await res.json();
    } catch {
      throw new ExchangeError('Exchange returned a non-JSON response', { retryable: true });
    }
  }

  return {
    createPull: () => call('/pulls', { method: 'POST' }),
    getPull: (id) => call(`/pulls/${encodeURIComponent(id)}`),
  };
}
