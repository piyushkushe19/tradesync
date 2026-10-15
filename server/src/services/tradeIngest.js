import { z } from 'zod';
import { Trade } from '../models/Trade.js';

const incomingTrade = z.object({
  tradeId: z.string().regex(/^[A-Za-z0-9_-]{3,40}$/),
  client: z.string().trim().min(1).max(40),
  symbol: z.string().trim().min(1).max(20).transform((s) => s.toUpperCase()),
  quantity: z.number().int().positive(),
  price: z.number().positive().finite(),
  timestamp: z.string().datetime().transform((s) => new Date(s)),
});

/** Bulk writes bypass Mongoose validators, so every record is validated here first. */
export function validateTrades(raw) {
  if (!Array.isArray(raw)) throw new Error('Exchange payload is not an array of trades');
  const valid = [];
  let rejected = 0;
  const seen = new Set();
  for (const r of raw) {
    const parsed = incomingTrade.safeParse(r);
    if (!parsed.success) { rejected += 1; continue; }
    if (seen.has(parsed.data.tradeId)) continue; // duplicate inside one payload: keep first
    seen.add(parsed.data.tradeId);
    const t = parsed.data;
    valid.push({
      tradeId: t.tradeId,
      client: t.client,
      symbol: t.symbol,
      quantity: t.quantity,
      priceMinor: Math.round(t.price * 100),
      notionalMinor: Math.round(t.price * 100) * t.quantity,
      timestamp: t.timestamp,
    });
  }
  return { valid, rejected };
}

/**
 * Idempotent ingestion: unordered bulk upserts keyed by the unique tradeId. Re-running the
 * same payload (retry, duplicate delivery, re-sync) can never create duplicates.
 * `matched` = pre-existing trades that were re-written; `upserted` = brand-new trades.
 */
export async function upsertTrades(trades, { chunkSize, onChunk }) {
  let upserted = 0;
  let matched = 0;
  let processed = 0;
  for (let i = 0; i < trades.length; i += chunkSize) {
    const chunk = trades.slice(i, i + chunkSize);
    const result = await Trade.bulkWrite(
      chunk.map((t) => ({
        updateOne: {
          filter: { tradeId: t.tradeId },
          update: { $set: { client: t.client, symbol: t.symbol, quantity: t.quantity, priceMinor: t.priceMinor, notionalMinor: t.notionalMinor, timestamp: t.timestamp } },
          upsert: true,
        },
      })),
      { ordered: false },
    );
    upserted += result.upsertedCount ?? 0;
    matched += result.matchedCount ?? 0;
    processed += chunk.length;
    await onChunk?.({ processed, total: trades.length });
  }
  return { upserted, matched, processed };
}
