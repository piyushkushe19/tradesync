// Redis-backed event bus. The worker (a different OS process) publishes; every API
// instance subscribes and fans events out to its connected SSE clients.
const LOG_LENGTH = 200; // events retained for Last-Event-ID replay

const keys = (prefix) => ({
  seq: `${prefix}:events:seq`,
  log: `${prefix}:events:log`,
  channel: `${prefix}:events`,
});

export function createEventPublisher(redis, prefix) {
  const k = keys(prefix);
  return {
    /** Publish only AFTER the corresponding state transition was persisted. */
    async publish(type, data) {
      const id = await redis.incr(k.seq);
      const event = { id, type, data, at: new Date().toISOString() };
      const json = JSON.stringify(event);
      await redis.multi().lpush(k.log, json).ltrim(k.log, 0, LOG_LENGTH - 1).publish(k.channel, json).exec();
      return event;
    },
  };
}

/** `subscriber` must be a dedicated connection (redis.duplicate()). */
export async function subscribeEvents(subscriber, prefix, { onEvent, onResync }) {
  const k = keys(prefix);
  let first = true;
  subscriber.on('message', (channel, message) => {
    if (channel !== k.channel) return;
    try { onEvent(JSON.parse(message)); } catch { /* ignore malformed payloads */ }
  });
  // After a Redis reconnect we may have missed messages: tell clients to reconcile.
  subscriber.on('ready', () => {
    if (!first) onResync?.();
    first = false;
  });
  await subscriber.subscribe(k.channel);
}

export async function readEventsSince(redis, prefix, lastId) {
  const raw = await redis.lrange(keys(prefix).log, 0, LOG_LENGTH - 1);
  return raw
    .map((s) => { try { return JSON.parse(s); } catch { return null; } })
    .filter((e) => e && e.id > lastId)
    .sort((a, b) => a.id - b.id);
}
