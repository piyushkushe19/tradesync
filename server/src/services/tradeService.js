import { Trade } from '../models/Trade.js';
import { SyncJob, ACTIVE_STATUSES } from '../models/SyncJob.js';
import { serializeTrade, serializeJob } from '../utils/serialize.js';

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SORT_FIELDS = { price: 'priceMinor' };

export async function listTrades(q) {
  const filter = {};
  if (q.symbol) filter.symbol = q.symbol;
  if (q.from || q.to) filter.timestamp = { ...(q.from && { $gte: q.from }), ...(q.to && { $lte: q.to }) };
  if (q.search) {
    const re = new RegExp(escapeRegex(q.search), 'i'); // user input is escaped: no regex injection
    filter.$or = [{ tradeId: re }, { client: re }, { symbol: re }];
  }
  const dir = q.sortOrder === 'asc' ? 1 : -1;
  const sort = { [SORT_FIELDS[q.sortBy] ?? q.sortBy]: dir, tradeId: 1 }; // tradeId tiebreak = stable pages

  const [docs, total] = await Promise.all([
    Trade.find(filter).sort(sort).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
    Trade.countDocuments(filter),
  ]);
  return {
    items: docs.map(serializeTrade),
    pagination: { page: q.page, limit: q.limit, total, totalPages: Math.max(1, Math.ceil(total / q.limit)) },
  };
}

export async function getStats() {
  const [bySymbol, latest, active, lastSuccessful, latestJob] = await Promise.all([
    Trade.aggregate([
      { $group: { _id: '$symbol', trades: { $sum: 1 }, quantity: { $sum: '$quantity' }, valueMinor: { $sum: '$notionalMinor' } } },
      { $sort: { valueMinor: -1 } },
    ]),
    Trade.findOne().sort({ timestamp: -1 }).select('timestamp').lean(),
    SyncJob.findOne({ status: { $in: ACTIVE_STATUSES } }).sort({ createdAt: -1 }),
    SyncJob.findOne({ status: 'completed' }).sort({ completedAt: -1 }),
    SyncJob.findOne().sort({ createdAt: -1 }),
  ]);
  const totals = bySymbol.reduce(
    (a, s) => ({ trades: a.trades + s.trades, quantity: a.quantity + s.quantity, valueMinor: a.valueMinor + s.valueMinor }),
    { trades: 0, quantity: 0, valueMinor: 0 },
  );
  return {
    totalTrades: totals.trades,
    distinctSymbols: bySymbol.length,
    totalQuantity: totals.quantity,
    totalValue: totals.valueMinor / 100,
    averageTradeValue: totals.trades ? totals.valueMinor / 100 / totals.trades : 0,
    latestTradeAt: latest ? latest.timestamp.toISOString() : null,
    topSymbols: bySymbol.slice(0, 10).map((s) => ({ symbol: s._id, trades: s.trades, quantity: s.quantity, value: s.valueMinor / 100 })),
    symbols: bySymbol.map((s) => s._id).sort(),
    latestSuccessfulSync: serializeJob(lastSuccessful),
    currentSync: serializeJob(active ?? latestJob),
    syncInProgress: Boolean(active),
  };
}
