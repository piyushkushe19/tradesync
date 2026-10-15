// Deterministic trade generator. Record i depends only on i (never on the total count),
// so raising EXCHANGE_TRADE_COUNT later yields the same first N trades plus new ones.

const SYMBOLS = [
  ['RELIANCE', 1425], ['TCS', 3850], ['HDFCBANK', 1650], ['INFY', 1520], ['ICICIBANK', 1180],
  ['SBIN', 820], ['BHARTIARTL', 1610], ['ITC', 465], ['LT', 3600], ['HINDUNILVR', 2450],
  ['KOTAKBANK', 1850], ['AXISBANK', 1130], ['MARUTI', 12500], ['SUNPHARMA', 1720], ['TITAN', 3400],
  ['ASIANPAINT', 2400], ['WIPRO', 480], ['NTPC', 360], ['ONGC', 270], ['TATAMOTORS', 940],
];
const LOT_SIZES = [1, 5, 10, 25, 50, 100];
const SEED = 20261014;
const SESSION_OPEN_MS = Date.UTC(2026, 9, 14, 3, 45, 0); // 09:15 IST on 2026-10-14

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateTrade(index) {
  const rand = mulberry32((SEED + Math.imul(index + 1, 2654435761)) >>> 0);
  const [symbol, base] = SYMBOLS[Math.floor(rand() * SYMBOLS.length)];
  const lot = LOT_SIZES[Math.floor(rand() * LOT_SIZES.length)];
  const quantity = lot * (1 + Math.floor(rand() * 10));
  const drift = 1 + (rand() - 0.5) * 0.04; // +/- 2% around the reference price
  const priceMinor = Math.max(5, Math.round((base * drift * 100) / 5) * 5); // 5-paise tick
  const client = `CLIENT-${1001 + Math.floor(rand() * 250)}`;
  const ts = SESSION_OPEN_MS + index * 4000 + Math.floor(rand() * 3000);
  return {
    tradeId: `BSE-2026-${String(index + 1).padStart(6, '0')}`,
    client,
    symbol,
    quantity,
    price: priceMinor / 100,
    timestamp: new Date(ts).toISOString(),
  };
}

const cache = new Map();
export function generateTrades(count) {
  if (!cache.has(count)) cache.set(count, Array.from({ length: count }, (_, i) => generateTrade(i)));
  return cache.get(count);
}
