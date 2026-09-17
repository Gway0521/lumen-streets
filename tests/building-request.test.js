import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { requestBytes } from "../src/three/request.js";

async function serve(t, handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}
test("temporary failure retries, permanent HTTP and oversized data do not", async t => {
  let requests = 0, status = 503;
  const url = await serve(t, (_req, res) => {
    requests++;
    res.writeHead(requests === 2 ? 200 : status); res.end("test-data");
  });
  assert.equal(new TextDecoder().decode(await requestBytes(url, { delay: 1 })), "test-data");
  assert.equal(requests, 2);
  requests = 0; status = 404;
  await assert.rejects(requestBytes(url, { delay: 1 }), /404/);
  assert.equal(requests, 1);
  requests = 0; status = 200;
  await assert.rejects(requestBytes(url, { maximum: 2, delay: 1 }), /size budget/);
  assert.equal(requests, 1);
});
test("timeout also bounds a response body that never finishes", async t => {
  let requests = 0;
  const url = await serve(t, (_req, res) => { requests++; res.writeHead(200); res.write("partial"); });
  await assert.rejects(requestBytes(url, { timeout: 30, retries: 1, delay: 1 }), { name: "TimeoutError" });
  assert.equal(requests, 2);
});
test("cancelling a fetch or its backoff prevents further requests", async t => {
  let requests = 0;
  const controller = new AbortController();
  const url = await serve(t, (_req, res) => { requests++; res.writeHead(503, { "Retry-After": "1" }); res.end(); });
  const promise = requestBytes(url, { signal: controller.signal });
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(promise, { name: "AbortError" });
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(requests, 1);
  const during = new AbortController();
  const stalled = await serve(t, (_req, res) => { res.writeHead(200); res.write("partial"); setTimeout(() => during.abort(), 10); });
  await assert.rejects(requestBytes(stalled, { signal: during.signal }), { name: "AbortError" });
});
test("retry budget is finite and long Retry-After is respected without an early retry", async t => {
  let requests = 0, retryAfter = "0";
  const url = await serve(t, (_req, res) => { requests++; res.writeHead(429, { "Retry-After": retryAfter }); res.end(); });
  await assert.rejects(requestBytes(url, { delay: 1 }), /429/);
  assert.equal(requests, 3);
  requests = 0; retryAfter = "60";
  await assert.rejects(requestBytes(url, { delay: 1 }), /429/);
  assert.equal(requests, 1);
});
