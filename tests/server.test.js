import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { EventEmitter } from 'node:events';
import { createSiteServer } from '../server/site.mjs';
import { createGuard } from '../server/guard.mjs';
import { readConfig } from '../server/config.mjs';
import { createMapService } from '../server/maps.mjs';

const origin = 'https://night.example.com';
async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'lumen-host-test-')), dist = join(root, 'dist');
  await mkdir(join(dist, 'assets'), { recursive: true });
  await writeFile(join(dist, 'index.html'), '<h1>Night</h1>');
  await writeFile(join(dist, 'assets/app-hash.js'), 'const night = true;');
  await writeFile(join(dist, 'clip.mp4'), '0123456789');
  await writeFile(join(root, 'secret.txt'), 'private');
  const service = options.service || { search: async () => ({ results: [] }), map: async () => ({ raw: {} }) };
  const server = await createSiteServer({ dist, service, origin, ...options });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await rm(root, { recursive: true, force: true }); });
  const send = (path = '/', { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: server.address().port, path, method,
      headers: { Host: new URL(origin).host, ...headers } }, res => {
      const parts = []; res.on('data', b => parts.push(b));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts).toString() }));
    });
    req.on('error', reject); req.end(body);
  });
  return { server, root, dist, send };
}
const json = { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' };

test('standalone website serves only build files, with conditional and range responses', async t => {
  const { send, dist, root } = await fixture(t);
  let res = await send('/'); assert.equal(res.status, 200); assert.match(res.body, /Night/);
  assert.equal(res.headers['cache-control'], 'no-cache'); assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal((await send('/', { headers: { 'If-None-Match': res.headers.etag } })).status, 304);
  res = await send('/assets/app-hash.js'); assert.match(res.headers['cache-control'], /immutable/);
  for (const path of ['/../secret.txt','/%2e%2e/secret.txt','/..%5csecret.txt','/.env','/server/start.mjs','/C:/secret.txt','//secret.txt','/missing','/assets']) {
    assert.equal((await send(path)).status, 404, path);
  }
  assert.equal((await send('/%XX')).status, 400);
  assert.equal((await send('/', { method: 'POST' })).status, 405);
  assert.equal((await send('/', { method: 'HEAD' })).body, '');
  res = await send('/clip.mp4', { headers: { Range: 'bytes=2-5' } }); assert.equal(res.status, 206); assert.equal(res.body, '2345');
  assert.equal(res.headers['content-range'], 'bytes 2-5/10');
  assert.equal((await send('/clip.mp4', { headers: { Range: 'bytes=-3' } })).body, '789');
  assert.equal((await send('/clip.mp4', { headers: { Range: 'bytes=100-' } })).status, 416);
  assert.equal((await send('/clip.mp4', { headers: { Range: 'bytes=1-2', 'If-Range': 'old' } })).status, 200);
  // POSIX permits this without administrator privileges; Windows may not.
  if (process.platform !== 'win32') {
    await symlink(join(root, 'secret.txt'), join(dist, 'escape.txt'));
    assert.equal((await send('/escape.txt')).status, 404);
  }
});

test('public API accepts its configured origin, rejects forged origins, methods and oversized JSON', async t => {
  let calls = 0;
  const { send } = await fixture(t, { service: { search: async () => { calls++; return { results: [] }; } } });
  assert.deepEqual(JSON.parse((await send('/api/capabilities')).body), { search: true });
  for (const headers of [{ Host: 'evil.test' }, { Origin: 'https://evil.test' }, { 'Sec-Fetch-Site': 'same-site' }, { 'Content-Type': 'text/plain' }]) {
    assert([400,403].includes((await send('/api/search', { ...json, headers: { ...json.headers, ...headers } })).status));
  }
  assert.equal((await send('/api/search', { ...json, body: 'x'.repeat(4097), headers: { ...json.headers, 'Content-Length': '4097' } })).status, 413);
  assert.equal((await send('/api/search', { ...json, body: 'not json' })).status, 400);
  assert.equal((await send('/api/forward?url=https://evil.test', json)).status, 404);
  assert.equal(calls, 0);
  const good = await send('/api/search', json); assert.equal(good.status, 200); assert.equal(calls, 1);
  assert.equal(good.headers['cache-control'], 'no-store'); assert.equal(good.headers['access-control-allow-origin'], undefined);
});

test('proxy address trust is explicit; requests are limited per visitor, including spoof attempts', async t => {
  const { send } = await fixture(t, { trustProxy: true, guardOptions: { perMinute: 2 } });
  assert.equal((await send('/api/search', json)).status, 403);
  const post = ip => send('/api/search', { ...json, headers: { ...json.headers, 'X-Lumen-Client-IP': ip } });
  assert.equal((await post('192.0.2.1')).status, 200);
  assert.equal((await post('192.0.2.1')).status, 200);
  const busy = await post('192.0.2.1'); assert.equal(busy.status, 429); assert(Number(busy.headers['retry-after']) > 0);
  assert.equal((await post('192.0.2.2')).status, 200);
  assert.equal((await post('2001:db8::1')).status, 200);
  assert.equal((await post('2001:db8::2')).status, 200);
  assert.equal((await post('2001:0db8:0:0:abcd::1')).status, 429);
  const direct = await fixture(t, { guardOptions: { perMinute: 1 } });
  assert.equal((await direct.send('/api/search', json)).status, 200);
  assert.equal((await direct.send('/api/search', { ...json, headers: { ...json.headers, 'X-Lumen-Client-IP': '192.0.2.9' } })).status, 429);
});

test('active-request limits release on cancellation and client tables remain bounded', () => {
  let time = 0;
  const guard = createGuard({ origin, trustProxy: true, now: () => time, maxActive: 2, maxClients: 2 });
  const req = ip => ({ url: '/api/map', method: 'POST', headers: { host: 'night.example.com', 'x-lumen-client-ip': ip }, socket: { remoteAddress: '127.0.0.1' } });
  const a = new EventEmitter(), b = new EventEmitter(); guard(req('192.0.2.1'), a); guard(req('192.0.2.2'), b);
  assert.throws(() => guard(req('192.0.2.2'), new EventEmitter()), e => e.code === 'quota');
  a.emit('close'); a.emit('finish');
  const c = new EventEmitter(); guard(req('192.0.2.2'), c);
  assert.throws(() => guard(req('192.0.2.3'), new EventEmitter()), e => e.code === 'quota');
  b.emit('finish'); c.emit('finish'); time = 60001;
  assert.doesNotThrow(() => guard(req('192.0.2.3'), new EventEmitter()));
});

test('a loopback tunnel uses its selected visitor header without trusting alternate or malformed headers', async t => {
  const config = readConfig({ LUMEN_PUBLIC_ORIGIN: origin, LUMEN_TRUST_PROXY: '1', LUMEN_PROXY_IP_HEADER: 'cf-connecting-ip' });
  const { send } = await fixture(t, { origin: config.origin, trustProxy: config.trustProxy, proxyIpHeader: config.proxyIpHeader, guardOptions: { perMinute: 1 } });
  const post = headers => send('/api/search', { ...json, headers: { ...json.headers, ...headers } });
  assert.equal((await post({ 'CF-Connecting-IP': '192.0.2.1' })).status, 200);
  assert.equal((await post({ 'CF-Connecting-IP': '192.0.2.1', 'X-Lumen-Client-IP': '192.0.2.99', 'X-Forwarded-For': '192.0.2.98' })).status, 429);
  assert.equal((await post({ 'CF-Connecting-IP': '192.0.2.2' })).status, 200);
  for (const headers of [{}, { 'X-Lumen-Client-IP': '192.0.2.3' }, { 'CF-Connecting-IP': 'bad' }, { 'CF-Connecting-IP': '192.0.2.3, 192.0.2.4' }]) {
    assert.equal((await post(headers)).status, 403);
  }
  assert.equal((await post({ 'CF-Connecting-IP': '2001:db8::1' })).status, 200);
  assert.equal((await post({ 'CF-Connecting-IP': '2001:db8::2' })).status, 429);
  const guard = createGuard(config);
  assert.throws(() => guard({ url: '/api/search', method: 'POST', headers: { host: 'night.example.com', 'cf-connecting-ip': '192.0.2.1' }, socket: { remoteAddress: '192.0.2.10' } }, new EventEmitter()), e => e.status === 403);
  const direct = await fixture(t, { proxyIpHeader: 'cf-connecting-ip', guardOptions: { perMinute: 1 } });
  const directPost = ip => direct.send('/api/search', { ...json, headers: { ...json.headers, 'CF-Connecting-IP': ip } });
  assert.equal((await directPost('192.0.2.1')).status, 200);
  assert.equal((await directPost('192.0.2.2')).status, 429);
});

test('production provider budgets are configurable, persistent and do not charge cached results', async t => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'lumen-host-cache-'));
  t.after(() => rm(cacheDir, { recursive: true, force: true }));
  let calls = 0;
  const fetcher = async () => { calls++; return Response.json({ features: [] }); };
  const config = { fetcher, cacheDir, interval: 0, searchLimit: 1 };
  const service = createMapService(config), signal = new AbortController().signal;
  const input = { query: 'Sapporo', locale: 'en' };
  assert.equal((await service.search(input, signal)).cache, 'miss');
  const restarted = createMapService(config);
  assert.equal((await restarted.search(input, signal)).cache, 'hit');
  await assert.rejects(restarted.search({ ...input, query: 'Tokyo' }, signal), e => e.code === 'dailyLimit');
  assert.equal(calls, 1);
});

test('startup rejects unsafe or malformed public configuration', () => {
  assert.equal(readConfig({}).origin, 'http://127.0.0.1:5180');
  assert.equal(readConfig({ LUMEN_PUBLIC_ORIGIN: origin, LUMEN_TRUST_PROXY: '1' }).trustProxy, true);
  for (const config of [{ PORT: 'NaN' }, { PORT: '-1' }, { LUMEN_PUBLIC_ORIGIN: origin+'/path' }, { LUMEN_PUBLIC_ORIGIN: 'file:///tmp' },
    { LUMEN_HOST: '0.0.0.0' }, { LUMEN_HOST: '0.0.0.0', LUMEN_PUBLIC_ORIGIN: origin, LUMEN_TRUST_PROXY: '1' }, { LUMEN_SEARCH_DAILY_LIMIT: '0' },
    { LUMEN_PROXY_IP_HEADER: 'x-forwarded-for' }, { LUMEN_PROXY_IP_HEADER: 'host' },
    { LUMEN_HOST: '0.0.0.0', LUMEN_PUBLIC_ORIGIN: origin, LUMEN_TRUST_PROXY: '1', LUMEN_PROXY_IP_HEADER: 'cf-connecting-ip' }]) {
    assert.throws(() => readConfig(config));
  }
});

test('closing a public HTTP request cancels its map operation', async t => {
  let start, cancelled;
  const started = new Promise(r => { start = r; }), aborted = new Promise(r => { cancelled = r; });
  const service = { map: async (_, signal) => {
    start();
    return new Promise((_, reject) => signal.addEventListener('abort', () => { cancelled(); reject(signal.reason); }, { once: true }));
  } };
  const { server } = await fixture(t, { service });
  const req = request({ host: '127.0.0.1', port: server.address().port, path: '/api/map', method: 'POST',
    headers: { Host: 'night.example.com', Origin: origin, 'Content-Type': 'application/json' } });
  req.on('error', () => {}); req.end('{}'); await started; req.destroy();
  await aborted;
});
