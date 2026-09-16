import { isIP } from 'node:net';
import { MapRequestError } from '../src/search/area.js';

// One process owns the limits. No forwarded address is trusted in direct mode.
export function createGuard({ origin, trustProxy = false, proxyIpHeader = 'x-lumen-client-ip', now = Date.now, perMinute = 30, maxClients = 10000, maxActive = 16, perClientActive = 2 }) {
  if (!['x-lumen-client-ip', 'cf-connecting-ip'].includes(proxyIpHeader)) throw Error('Invalid proxy IP header');
  const host = new URL(origin).host, clients = new Map();
  let active = 0, nextPrune = 0;
  return (req, res) => {
    if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== origin) ||
        ['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])) throw new MapRequestError('forbidden', 403);
    if (req.url.split('?')[0] === '/api/capabilities' && req.method === 'GET') return;
    let ip = req.socket.remoteAddress;
    if (trustProxy) {
      const forwardedIp = req.headers[proxyIpHeader];
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip) ||
          typeof forwardedIp !== 'string' || !isIP(forwardedIp) || forwardedIp.includes('%')) {
        throw new MapRequestError('forbidden', 403);
      }
      ip = forwardedIp;
    }
    if (ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
    // Group IPv6 privacy addresses by /64 rather than allowing address rotation to reset a bucket.
    if (isIP(ip) === 6) {
      const parts = new URL(`http://[${ip}]/`).hostname.slice(1, -1).split('::');
      const left = parts[0] ? parts[0].split(':') : [], right = parts[1] ? parts[1].split(':') : [];
      ip = [...left, ...Array(8 - left.length - right.length).fill('0'), ...right].slice(0, 4).join(':');
    }
    const time = now();
    if (time >= nextPrune) {
      for (const [key, item] of clients) if (!item.active && time >= item.reset) clients.delete(key);
      nextPrune = time + 60000;
    }
    if (!clients.has(ip)) {
      if (clients.size >= maxClients) throw new MapRequestError('quota', 429, 60);
      clients.set(ip, { count: 0, reset: time + 60000, active: 0 });
    }
    const client = clients.get(ip);
    if (time >= client.reset) { client.count = 0; client.reset = time + 60000; }
    if (++client.count > perMinute || client.active >= perClientActive || active >= maxActive) {
      throw new MapRequestError('quota', 429, Math.max(2, Math.ceil((client.reset - time) / 1000)));
    }
    active++; client.active++;
    let released = false;
    const release = () => { if (!released) { active--; client.active--; released = true; } };
    res.once('finish', release); res.once('close', release);
  };
}
