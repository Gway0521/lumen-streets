# Hosting

[繁體中文](HOSTING.zh-TW.md)

Lumen Streets runs as one Node.js 24 process serving the website and search API. Rendering and exports run in visitors' browsers; the server needs no database or GPU.

## Build and run

From the source checkout:

```sh
npm ci
npm run build
cp .env.example .env
npm start
```

Open `http://127.0.0.1:5180/`. For hosting, edit `.env` with your public HTTPS address and restart the process.

To prepare an uploadable build, run `npm run pack:site`. Transfer `artifacts/lumen-streets.tar.gz` and its `.sha256` file to the server, verify with `sha256sum -c lumen-streets.tar.gz.sha256`, and extract it. The archive includes the built app and backend; run `npm start` inside it with Node 24. Runtime npm installation is not needed.

## Connect your domain

Use an HTTPS reverse proxy or tunnel on the same machine, forwarding every path to `http://127.0.0.1:5180`. Keep the public Host header intact.

| Setting in `.env` | Value |
| --- | --- |
| `LUMEN_PUBLIC_ORIGIN` | Your full origin, e.g. `https://night.example.com`, without a subpath |
| `LUMEN_HOST` | `127.0.0.1` |
| `PORT` | `5180` |
| `LUMEN_TRUST_PROXY` | `1` when using the local proxy or tunnel |
| `LUMEN_PROXY_IP_HEADER` | `x-lumen-client-ip`, or `cf-connecting-ip` for a direct Cloudflare Tunnel connection |
| `LUMEN_CACHE_DIR` | A writable, persistent directory outside the served `dist/` folder |

The proxy must overwrite the selected IP header with the verified visitor address so rate limits apply per visitor. The server accepts it only from a loopback connection. Keep port 5180 private. Direct local use keeps `LUMEN_TRUST_PROXY=0`.

For [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/), run `cloudflared` on the Node host and route the public hostname to `http://127.0.0.1:5180`. Set `LUMEN_PROXY_IP_HEADER=cf-connecting-ip`; if you set an HTTP Host Header override, use your public hostname. The tunnel provides public HTTPS.

Keep HTML cache lifetimes short and respect `no-store` on `/api/*`. Search endpoints and request budgets are described in [Map services](PROVIDERS.md).

## Keep it running

Use your process manager to restart the app after reboot or failure. Linux users can adapt `deploy/lumen-streets.service` and `deploy/server.env.example`: set the service user, working directory, Node executable and environment-file paths for the host. Run one process per cache directory.

To update, replace the application files, keep the environment and cache, and restart the process. Retaining the previous build allows rollback.

Check the public URL from another device: load a preset, search for a place, import a small area, download a PNG/video, and open a player link. A 403 usually indicates a Host, origin or proxy-header mismatch; 429 indicates a request allowance or provider cooldown.

## Static-only hosting

Serve the contents of `dist/` on any HTTPS static host to use bundled maps, exports and scene files. Search is hidden without the API. Relative assets support a subdirectory; no SPA fallback is required.

## Source and license

Each `npm run build` creates `dist/lumen-streets-source.tar.gz` from the current source, build scripts and documentation. Deploy it together with `dist/source.html`, `dist/license.txt` and the website so visitors can obtain the corresponding source. Rebuild and replace the source archive whenever you deploy a modified version. Source packaging requires `tar`, available on Ubuntu, macOS and recent Windows versions.
