import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import IORedis from 'ioredis';
import { env } from '../src/config/env.js';
import { createExchangeApp } from '../src/exchange/app.js';
import { generateTrades } from '../src/exchange/tradeGenerator.js';
import { sleep } from './helpers.js';

let redis;
let app;

beforeAll(async () => {
  redis = new IORedis(env.REDIS_URL);
  await redis.flushdb();
  app = createExchangeApp({ redis, config: { ...env, EXCHANGE_PULL_DELAY_MS: 300, EXCHANGE_TRADE_COUNT: 3000 } });
});
afterAll(async () => { await redis.quit(); });

describe('mock BSE exchange', () => {
  it('GET /getTrades returns valid, deterministic seeded records', async () => {
    const a = await request(app).get('/getTrades').expect(200);
    const b = await request(app).get('/getTrades').expect(200);
    expect(a.body.count).toBe(3000);
    expect(a.body.trades).toEqual(b.body.trades);
    const t = a.body.trades[0];
    expect(t).toEqual({
      tradeId: 'BSE-2026-000001', client: expect.stringMatching(/^CLIENT-\d{4}$/), symbol: expect.any(String),
      quantity: expect.any(Number), price: expect.any(Number), timestamp: expect.stringMatching(/Z$/),
    });
    expect(new Set(a.body.trades.map((x) => x.tradeId)).size).toBe(3000);
    expect(a.body.trades.every((x) => Number.isInteger(x.quantity) && x.quantity > 0 && x.price > 0)).toBe(true);
  });

  it('supports thousands of records and a stable prefix when the count grows', () => {
    expect(generateTrades(5000)).toHaveLength(5000);
    expect(generateTrades(100)).toEqual(generateTrades(5000).slice(0, 100));
  });

  it('POST /pulls returns an operation id promptly (202) without holding the connection', async () => {
    const started = Date.now();
    const res = await request(app).post('/pulls').expect(202);
    expect(Date.now() - started).toBeLessThan(500);
    expect(res.body).toMatchObject({ operationId: expect.stringMatching(/^op_/), status: 'pending', retryAfterMs: 300 });
  });

  it('the pull is pending, then completes with the dataset once the delay elapsed', async () => {
    const { body: created } = await request(app).post('/pulls').expect(202);
    const pending = await request(app).get(`/pulls/${created.operationId}`).expect(200);
    expect(pending.body.status).toBe('pending');
    expect(pending.body.trades).toBeUndefined();
    await sleep(pending.body.retryAfterMs + 50); // wait exactly as long as the exchange said
    const done = await request(app).get(`/pulls/${created.operationId}`).expect(200);
    expect(done.body.status).toBe('completed');
    expect(done.body.trades).toHaveLength(3000);
  });

  it('can simulate failures and rejects unknown operations / modes', async () => {
    await request(app).post('/admin/mode').send({ mode: 'fail' }).expect(200);
    const { body } = await request(app).post('/pulls').expect(202);
    await sleep(350);
    const res = await request(app).get(`/pulls/${body.operationId}`).expect(200);
    expect(res.body.status).toBe('failed');
    await request(app).post('/admin/mode').send({ mode: 'none' }).expect(200);
    await request(app).post('/admin/mode').send({ mode: 'bogus' }).expect(400);
    await request(app).get('/pulls/op_missing').expect(404);
  });
});
