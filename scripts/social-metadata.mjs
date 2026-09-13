// Emit crawlable HTML at build time; social crawlers need no JavaScript.
export function socialMetadata(siteURL = 'https://lumenstreets.feifeihome.com/') {
  const base = new URL(siteURL);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash)
    throw new Error('LUMEN_SITE_URL must be a public HTTP(S) URL without credentials, query or fragment.');
  base.pathname = base.pathname.replace(/\/$/, '') + '/';
  return {
    name: 'lumen-social-metadata',
    transformIndexHtml(_html, context) {
      const player = context.filename.replaceAll('\\', '/').endsWith('/player.html');
      const title = player ? 'Lumen Streets · Shared nightscape' : 'Lumen Streets · Living nightscapes';
      const description = 'Turn real streets into animated nightscapes. Create and export wallpapers of your favorite places. Free and open source.';
      const image = new URL('social-preview.jpg', base).href;
      const alt = 'Lumen Streets: golden streets of Sapporo at night. Map data © OpenStreetMap contributors, ODbL.';
      const meta = (key, content) => ({ tag: 'meta', attrs: { [key.startsWith('og:') ? 'property' : 'name']: key, content }, injectTo: 'head' });
      return [
        meta('og:type', 'website'), meta('og:site_name', 'Lumen Streets'),
        meta('og:title', title), meta('og:description', description),
        // Player scenes live in URL fragments; do not collapse them to one og:url.
        ...(!player ? [meta('og:url', base.href), { tag: 'link', attrs: { rel: 'canonical', href: base.href }, injectTo: 'head' }] : []),
        meta('og:image', image), meta('og:image:type', 'image/jpeg'),
        meta('og:image:width', '1280'), meta('og:image:height', '640'), meta('og:image:alt', alt),
        meta('twitter:card', 'summary_large_image'), meta('twitter:title', title),
        meta('twitter:description', description), meta('twitter:image', image), meta('twitter:image:alt', alt),
      ];
    },
  };
}
