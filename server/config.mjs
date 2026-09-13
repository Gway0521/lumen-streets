export function readConfig(env = process.env) {
  const integer = (key, fallback, max) => {
    const value = env[key] === undefined ? fallback : Number(env[key]);
    if (!Number.isSafeInteger(value) || value < 1 || value > max) throw Error(`Invalid ${key}`);
    return value;
  };
  const port = integer('PORT', 5180, 65535), host = env.LUMEN_HOST || '127.0.0.1';
  const origin = new URL(env.LUMEN_PUBLIC_ORIGIN || `http://127.0.0.1:${port}`);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password ||
      origin.pathname !== '/' || origin.search || origin.hash) throw Error('LUMEN_PUBLIC_ORIGIN must be one HTTP(S) origin');
  if (!['127.0.0.1', '::1'].includes(host) && !env.LUMEN_PUBLIC_ORIGIN) throw Error('Set LUMEN_PUBLIC_ORIGIN when listening beyond loopback');
  if (env.LUMEN_TRUST_PROXY && !['0', '1'].includes(env.LUMEN_TRUST_PROXY)) throw Error('LUMEN_TRUST_PROXY must be 0 or 1');
  const trustProxy = env.LUMEN_TRUST_PROXY === '1';
  if (trustProxy && !['127.0.0.1', '::1'].includes(host)) throw Error('Trusted proxy mode requires a loopback listener');
  const proxyIpHeader = env.LUMEN_PROXY_IP_HEADER || 'x-lumen-client-ip';
  if (!['x-lumen-client-ip', 'cf-connecting-ip'].includes(proxyIpHeader)) throw Error('Invalid LUMEN_PROXY_IP_HEADER');
  return {
    host, port, origin: origin.origin, trustProxy, proxyIpHeader,
    service: {
      cacheDir: env.LUMEN_CACHE_DIR || '.cache/maps',
      searchLimit: integer('LUMEN_SEARCH_DAILY_LIMIT', 1000, 100000),
      mapLimit: integer('LUMEN_MAP_DAILY_LIMIT', 300, 10000),
      budget: integer('LUMEN_CACHE_MB', 512, 4096) * 1000000,
      userAgent: `LumenStreets/0.1 (${origin.origin})`,
    },
  };
}
