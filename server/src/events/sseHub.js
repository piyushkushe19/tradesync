import crypto from 'node:crypto';

export function formatSse({ id, event, data, comment, retry }) {
  let out = '';
  if (comment !== undefined) out += `: ${comment}\n`;
  if (retry !== undefined) out += `retry: ${retry}\n`;
  if (id !== undefined) out += `id: ${id}\n`;
  if (event) out += `event: ${event}\n`;
  if (data !== undefined) out += `data: ${JSON.stringify(data)}\n`;
  return `${out}\n`;
}

const MAX_BUFFERED_BYTES = 1024 * 1024;

export class SseHub {
  constructor({ heartbeatMs, maxClients, logger }) {
    this.clients = new Map();
    this.heartbeatMs = heartbeatMs;
    this.maxClients = maxClients;
    this.logger = logger;
    this.timer = null;
  }

  get size() { return this.clients.size; }
  isFull() { return this.clients.size >= this.maxClients; }

  add(req, res) {
    const client = { id: crypto.randomUUID(), res, lastId: 0, replaying: false, pending: [] };
    this.clients.set(client.id, client);
    const remove = () => this.remove(client.id);
    req.on('close', remove);
    res.on('error', remove);
    res.on('close', remove);
    this.#ensureHeartbeat();
    return client;
  }

  remove(id) {
    if (!this.clients.delete(id)) return;
    if (this.clients.size === 0 && this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  #write(client, frame) {
    const { res } = client;
    if (res.writableEnded || res.destroyed) return this.remove(client.id);
    if (res.writableLength > MAX_BUFFERED_BYTES) { // slow consumer: drop it, EventSource will reconnect
      this.logger?.warn('sse.slow_client_dropped', { clientId: client.id });
      res.destroy();
      return this.remove(client.id);
    }
    res.write(frame);
  }

  #deliver(client, evt) {
    if (evt.id !== undefined) {
      if (evt.id <= client.lastId) return; // de-dupe replay vs. live delivery
      client.lastId = evt.id;
    }
    this.#write(client, formatSse({ id: evt.id, event: evt.type, data: evt }));
  }

  sendEvent(client, evt) {
    if (client.replaying) { client.pending.push(evt); return; }
    this.#deliver(client, evt);
  }

  /** Send "connected", then replay missed events, then flush anything that arrived meanwhile. */
  async open(client, { connectedPayload, replay }) {
    client.replaying = true;
    this.#write(client, formatSse({ retry: 3000, event: 'connected', data: connectedPayload }));
    try {
      for (const evt of (await replay?.()) ?? []) this.#deliver(client, evt);
    } finally {
      client.replaying = false;
      client.pending.splice(0).sort((a, b) => (a.id ?? 0) - (b.id ?? 0)).forEach((e) => this.#deliver(client, e));
    }
  }

  broadcast(evt) {
    for (const client of this.clients.values()) this.sendEvent(client, evt);
  }

  /** Non-persistent hint (no id) telling dashboards to re-fetch current state. */
  broadcastResync() {
    for (const client of this.clients.values()) {
      this.#write(client, formatSse({ event: 'resync', data: { reason: 'event-bus-reconnected' } }));
    }
  }

  #ensureHeartbeat() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      for (const client of this.clients.values()) this.#write(client, formatSse({ comment: 'heartbeat' }));
    }, this.heartbeatMs);
    this.timer.unref();
  }

  closeAll() {
    for (const client of this.clients.values()) client.res.end();
    this.clients.clear();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
