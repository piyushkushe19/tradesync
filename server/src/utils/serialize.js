export function serializeTrade(t) {
  return {
    tradeId: t.tradeId,
    client: t.client,
    symbol: t.symbol,
    quantity: t.quantity,
    price: t.priceMinor / 100,
    timestamp: new Date(t.timestamp).toISOString(),
  };
}

const iso = (d) => (d ? new Date(d).toISOString() : null);

export function serializeJob(j) {
  if (!j) return null;
  const o = typeof j.toObject === 'function' ? j.toObject() : j;
  return {
    jobId: o.jobId,
    status: o.status,
    phase: o.phase ?? null,
    startedAt: iso(o.startedAt),
    completedAt: iso(o.completedAt),
    durationMs: o.durationMs ?? null,
    expectedTradeCount: o.expectedTradeCount ?? null,
    processedTradeCount: o.processedTradeCount ?? 0,
    insertedTradeCount: o.insertedTradeCount ?? 0,
    updatedTradeCount: o.updatedTradeCount ?? 0,
    rejectedTradeCount: o.rejectedTradeCount ?? 0,
    retryCount: o.retryCount ?? 0,
    errorMessage: o.errorMessage ?? null,
    expectedReadyAt: iso(o.exchangeReadyAt),
    createdAt: iso(o.createdAt),
    updatedAt: iso(o.updatedAt),
  };
}
