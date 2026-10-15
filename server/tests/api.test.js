import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createHarness, isFerretDB } from './helpers.js';
import { Trade } from '../src/models/Trade.js';
import { SyncJob } from '../src/models/SyncJob.js';
import { generateTrades } from '../src/exchange/tradeGenerator.js';

let h;
let ferret;

const seed = (n = 60) => Trade.insertMany(generateTrades(n).map((t) => ({
  tradeId: t.tradeId, client: t.client, symbol: t.symbol, quantity: t.quantity,
  priceMinor: Math.round(t.price * 100), notionalMinor: Math.round(t.price * 100) * t.quantity, timestamp: new Date(t.timestamp),
})));

beforeAll(async () => { h = await createHarness({ worker: false }); ferret = await isFerretDB(); });
afterAll(async () => { await h.close(); });
beforeEach(async () => { await h.reset(); });

describe('GET /api/trades', () => {
  it('returns stored records with pagination metadata (and price in rupees)', async () => {
    await seed();
    const res = await request(h.app).get('/api/trades?limit=10').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(10);
    expect(res.body.meta.pagination).toEqual({ page: 1, limit: 10, total: 60, totalPages: 6 });
    expect(res.body.data[0]).toEqual({
      tradeId: expect.any(String), client: expect.any(String), symbol: expect.any(String),
      quantity: expect.any(Number), price: expect.any(Number), timestamp: expect.any(String),
    });
  });

  it('paginates without overlap and filters by symbol / search / sort', async () => {
    await seed();
    const p1 = (await request(h.app).get('/api/trades?limit=20&page=1&sortBy=tradeId&sortOrder=asc')).body.data;
    const p2 = (await request(h.app).get('/api/trades?limit=20&page=2&sortBy=tradeId&sortOrder=asc')).body.data;
    expect(p1[0].tradeId).toBe('BSE-2026-000001');
    expect(p2[0].tradeId).toBe('BSE-2026-000021');
    expect(new Set([...p1, ...p2].map((t) => t.tradeId)).size).toBe(40);

    const symbol = p1[0].symbol;
    const bySymbol = (await request(h.app).get(`/api/trades?symbol=${symbol}`)).body.data;
    expect(bySymbol.length).toBeGreaterThan(0);
    expect(bySymbol.every((t) => t.symbol === symbol)).toBe(true);

    const found = (await request(h.app).get('/api/trades?search=000007')).body.data;
    expect(found.map((t) => t.tradeId)).toEqual(['BSE-2026-000007']);

    const byPrice = (await request(h.app).get('/api/trades?sortBy=price&sortOrder=asc&limit=60')).body.data.map((t) => t.price);
    expect(byPrice).toEqual([...byPrice].sort((a, b) => a - b));
  });

  it('rejects invalid pagination, sorting, unknown keys and operator injection', async () => {
    const bad = [
      '/api/trades?page=0', '/api/trades?limit=101', '/api/trades?limit=abc', '/api/trades?sortBy=password',
      '/api/trades?sortOrder=sideways', '/api/trades?price[$gt]=0', '/api/trades?symbol=A&symbol=B',
      '/api/trades?from=yesterday', '/api/trades?from=2026-10-15T00:00:00Z&to=2026-10-14T00:00:00Z', '/api/trades?symbol=../etc',
    ];
    for (const url of bad) {
      const res = await request(h.app).get(url);
      expect(res.status, url).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('GET /api/trades/stats summarises stored data', async () => {
    await seed();
    const { body } = await request(h.app).get('/api/trades/stats').expect(200);
    expect(body.data.totalTrades).toBe(60);
    expect(body.data.distinctSymbols).toBeGreaterThan(5);
    expect(body.data.syncInProgress).toBe(false);
    if (!ferret) { // FerretDB (local stand-in) does not implement $sum over fields correctly
      const expectedQty = generateTrades(60).reduce((a, t) => a + t.quantity, 0);
      expect(body.data.totalQuantity).toBe(expectedQty);
    }
  });
});

describe('POST /api/sync', () => {
  it('returns 202 promptly with a job id, before any synchronization could finish', async () => {
    const started = Date.now();
    const res = await request(h.app).post('/api/sync').expect(202);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(res.body).toMatchObject({ success: true, data: { jobId: expect.stringMatching(/^sync_/), status: 'queued', message: expect.any(String), createdAt: expect.any(String) } });
    const job = await SyncJob.findOne({ jobId: res.body.data.jobId });
    expect(job.status).toBe('queued'); // nothing has pulled yet: the request did not wait for it
  });

  it('keeps existing trades readable while a pull is active', async () => {
    await seed();
    await request(h.app).post('/api/sync').expect(202);
    const res = await request(h.app).get('/api/trades?limit=5').expect(200);
    expect(res.body.data).toHaveLength(5);
    const status = await request(h.app).get('/api/sync/status').expect(200);
    expect(status.body.data.active.status).toBe('queued');
  });

  it('allows only one active synchronization, even for concurrent requests', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => request(h.app).post('/api/sync')));
    const codes = results.map((r) => r.status).sort();
    expect(codes).toEqual([202, 409, 409, 409, 409, 409]);
    const conflict = results.find((r) => r.status === 409);
    expect(conflict.body.error).toMatchObject({ code: 'SYNC_IN_PROGRESS', details: { activeJobId: expect.stringMatching(/^sync_/) } });
    expect(await SyncJob.countDocuments()).toBe(1);
  });

  it('lists synchronization history with pagination', async () => {
    await request(h.app).post('/api/sync').expect(202);
    const res = await request(h.app).get('/api/sync/jobs?limit=5').expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.pagination.total).toBe(1);
    await request(h.app).get('/api/sync/jobs?limit=500').expect(400);
  });
});

describe('platform behaviour', () => {
  it('reports health, 404s unknown routes and never leaks internals', async () => {
    const health = await request(h.app).get('/api/health').expect(200);
    expect(health.body.data).toMatchObject({ status: 'ok', mongo: true, redis: true });
    const nf = await request(h.app).get('/api/nope').expect(404);
    expect(nf.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(JSON.stringify(nf.body)).not.toMatch(/stack|node_modules/);
    await request(h.app).post('/api/sync').set('Content-Type', 'application/json').send('{bad').expect(400);
  });
});
