import { readEventsSince } from '../events/eventBus.js';
import { AppError } from '../utils/errors.js';

export function createEventsController({ hub, redis, prefix, logger }) {
  return async function stream(req, res, next) {
    if (hub.isFull()) return next(new AppError(503, 'TOO_MANY_CONNECTIONS', 'Too many live connections'));
    req.socket.setTimeout(0);
    req.socket.setNoDelay(true);
    req.socket.setKeepAlive(true);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // disable proxy buffering (nginx)
    });
    res.flushHeaders();

    const client = hub.add(req, res);
    const lastEventId = Number.parseInt(req.get('last-event-id') ?? '', 10);
    if (Number.isFinite(lastEventId)) client.lastId = lastEventId;
    logger.debug('sse.connected', { clientId: client.id, clients: hub.size, lastEventId: client.lastId });

    try {
      await hub.open(client, {
        connectedPayload: { clientId: client.id, serverTime: new Date().toISOString() },
        replay: Number.isFinite(lastEventId) ? () => readEventsSince(redis, prefix, lastEventId) : undefined,
      });
    } catch (err) {
      // Replay is best effort; the dashboard reconciles via REST on (re)connect anyway.
      logger.warn('sse.replay_failed', { clientId: client.id, err });
    }
  };
}
