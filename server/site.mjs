import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { mapMiddleware } from './maps.mjs';
import { createGuard } from './guard.mjs';

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };

export async function createSiteServer({ service, origin, trustProxy = false, proxyIpHeader = 'x-lumen-client-ip', dist = 'dist', guardOptions = {} }) {
  const root = await realpath(resolve(dist));
  if (!(await stat(resolve(root, 'index.html'))).isFile()) throw Error('Build the website before starting');
  await service.ready;
  const api = mapMiddleware(service, {
    authorize: createGuard({ ...guardOptions, origin, trustProxy, proxyIpHeader }),
    onError: error => console.warn(JSON.stringify({ event: 'map_request_failed', code: error.code || 'unavailable' })),
  });
  const server = createServer({ maxHeaderSize: 8192, requestTimeout: 10000, headersTimeout: 10000, keepAliveTimeout: 5000 }, async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-cache');
    if (req.headers.host !== new URL(origin).host) { res.writeHead(403, { Connection: 'close' }); res.end('Forbidden'); return; }
    if (req.url.startsWith('/api/')) { await api(req, res, () => { res.writeHead(404); res.end(); }); return; }
    try {
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
      const name = decodeURIComponent(req.url.split('?')[0]);
      if (!name.startsWith('/') || /[\\\x00-\x1f:]/.test(name) || name.split('/').some(p => p.startsWith('.'))) {
        res.writeHead(404); res.end('Not found'); return;
      }
      const file = await realpath(resolve(root, '.' + (name === '/' ? '/index.html' : name)));
      if (!file.startsWith(root + sep)) { res.writeHead(404); res.end('Not found'); return; }
      const info = await stat(file);
      if (!info.isFile()) { res.writeHead(404); res.end('Not found'); return; }
      const etag = `"${info.size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}"`;
      res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
      res.setHeader('ETag', etag);
      res.setHeader('Accept-Ranges', 'bytes');
      if (name.startsWith('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      if (req.headers['if-none-match'] === etag) { res.writeHead(304); res.end(); return; }
      let start = 0, end = info.size - 1, status = 200;
      if (req.headers.range && (!req.headers['if-range'] || req.headers['if-range'] === etag)) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if (match && (match[1] || match[2])) {
          start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2]));
          end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
        } else start = info.size;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) {
          res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); res.end(); return;
        }
        status = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`);
      }
      res.setHeader('Content-Length', info.size ? end - start + 1 : 0);
      res.writeHead(status);
      if (req.method === 'HEAD' || !info.size) { res.end(); return; }
      await pipeline(createReadStream(file, { start, end }), res);
    } catch (error) {
      if (res.headersSent || res.destroyed) { res.destroy(); return; }
      res.writeHead(['ENOENT', 'ENOTDIR'].includes(error.code) ? 404 : error instanceof URIError ? 400 : 500);
      res.end(res.statusCode === 500 ? 'Unavailable' : 'Not found');
    }
  });
  server.maxConnections = 128;
  server.maxRequestsPerSocket = 100;
  server.setTimeout(60000, socket => socket.destroy());
  return server;
}
