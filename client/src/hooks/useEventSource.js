import { useEffect, useRef, useState } from 'react';

export const SSE_EVENT_TYPES = [
  'connected', 'sync:queued', 'sync:started', 'sync:progress',
  'sync:completed', 'sync:failed', 'trades:updated', 'resync',
];

/**
 * Native EventSource with explicit lifecycle handling.
 *  - Browser auto-reconnects on transient drops (and sends Last-Event-ID for replay).
 *  - If the browser gives up (readyState CLOSED, e.g. server returned an error) we re-create
 *    the connection with exponential backoff. That is reconnection, not polling.
 *  - `onReconnect` fires on every (re)open after the first one so the caller can reconcile
 *    state it may have missed while disconnected.
 */
export function useEventSource({ url, onEvent, onReconnect }) {
  const [status, setStatus] = useState('connecting'); // connecting | open | reconnecting
  const handlers = useRef({ onEvent, onReconnect });

  useEffect(() => {
    handlers.current = { onEvent, onReconnect };
  });

  useEffect(() => {
    let source;
    let retryTimer;
    let disposed = false;
    let attempts = 0;
    let openedBefore = false;

    const connect = () => {
      source = new EventSource(url);
      source.addEventListener('open', () => {
        attempts = 0;
        setStatus('open');
        if (openedBefore) handlers.current.onReconnect?.();
        openedBefore = true;
      });
      source.addEventListener('error', () => {
        if (disposed) return;
        setStatus('reconnecting');
        if (source.readyState === EventSource.CLOSED) {
          source.close();
          retryTimer = setTimeout(connect, Math.min(1000 * 2 ** attempts++, 15000));
        }
      });
      SSE_EVENT_TYPES.forEach((type) => {
        source.addEventListener(type, (e) => {
          try {
            handlers.current.onEvent?.(type, JSON.parse(e.data));
          } catch { /* ignore malformed frames */ }
        });
      });
    };

    connect();
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      source?.close();
    };
  }, [url]);

  return status;
}
