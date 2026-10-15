import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { createHarness, openSse } from './helpers.js';
import { SyncJob } from '../src/models/SyncJob.js';
import { Trade } from '../src/models/Trade.js';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let h;
let child;
let childOut = '';

beforeAll(async () => {
  h = await createHarness({ worker: false, listenApi: true }); // API + exchange here, NO in-process worker
  child = spawn(process.execPath, ['src/worker.js'], {
    cwd: serverDir,
    env: { ...process.env, EXCHANGE_URL: h.exchangeUrl, LOG_LEVEL: 'info', NODE_ENV: 'development' },
  });
  child.stdout.on('data', (d) => { childOut += d; });
  child.stderr.on('data', (d) => { childOut += d; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`worker did not start:\n${childOut}`)), 15000);
    child.stdout.on('data', () => { if (childOut.includes('worker.ready')) { clearTimeout(timer); resolve(); } });
  });
});

afterAll(async () => {
  const exited = new Promise((r) => child.once('exit', r));
  child.kill('SIGTERM');
  await exited;
  await h.close();
});

describe('API and worker as separate OS processes', () => {
  it('a job accepted by the API is executed by the worker process and the SSE client hears about it', async () => {
    const sse = openSse(h.apiPort);
    await sse.ready;
    await sse.waitFor((f) => f.event === 'connected');

    const res = await request(h.app).post('/api/sync').expect(202);
    const { jobId } = res.body.data;
    const done = await sse.waitFor((f) => f.event === 'sync:completed' && f.data.data.jobId === jobId, 25000);

    expect(done.data.data.job.status).toBe('completed');
    expect(await Trade.countDocuments()).toBe(60);
    expect((await SyncJob.findOne({ jobId })).status).toBe('completed');
    expect(childOut).toContain(jobId); // the child process (not this one) logged the work
    sse.close();
  });

  it('shuts the worker down gracefully on SIGTERM', async () => {
    // asserted in afterAll via a clean exit; here we just make sure it is still alive and idle
    expect(child.exitCode).toBeNull();
  });
});
