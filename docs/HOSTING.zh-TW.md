# 部署

[English](HOSTING.md)

Lumen Streets 用一個 Node.js 24 程序提供網站與搜尋 API。繪圖和匯出在訪客的瀏覽器執行，主機不需要資料庫或顯示卡。

3D 繪圖也會在瀏覽器載入線上向量圖磚與字型，預設地點亦需連網。更換相容圖磚來源時，請在建置端設定公開的 `VITE_LUMEN_TILEJSON_URL` 並重新建置；VITE 變數不可放憑證。詳見[地圖服務](PROVIDERS.md)。

## 建置與啟動

### 社群預覽與正式網址

每次建置會由 Vite 設定將 Open Graph 與 Twitter card 標籤直接寫進編輯器及播放器的 HTML，並複製 `public/social-preview.jpg`。爬蟲不需要執行 JavaScript。預設使用官方 DEMO 網址 `https://lumenstreets.feifeihome.com/`。

自行部署時，在**執行建置的電腦**建立被 Git 忽略的 `.env.production.local`，加入 `LUMEN_SITE_URL=https://night.example.com/`，再執行 `npm run pack:site`。子目錄部署需包含路徑，例如 `https://example.com/night/`。更新原始碼時保留這個檔案，或將變數設在建置系統；不要放入憑證。原始碼下載包不包含本機環境檔案。

`LUMEN_SITE_URL` 是建置設定，與執行時的 API 設定 `LUMEN_PUBLIC_ORIGIN` 不同。上傳預先建置的部署包後，修改伺服器環境變數不會改變 HTML；需重新建置再部署。不要手改 `dist/index.html`，下次建置會覆蓋。官方 DEMO 的預設部署包不需額外設定。

目前兩種語言與各播放器場景共用英文預覽卡，不會依網址片段產生個別城市縮圖。換圖時同步更新 `public/gallery/credits.json` 的來源紀錄，重新建置並等待平台刷新快取。GitHub Repo 的 Social preview 需另外在 Settings 上傳。

在原始碼目錄執行：

```sh
npm ci
npm run build
cp .env.example .env
npm start
```

開啟 `http://127.0.0.1:5180/`。對外架站時，將 `.env` 改成自己的 HTTPS 網址，再重新啟動。

若要在開發電腦打包後上傳，執行 `npm run pack:site`。將 `artifacts/lumen-streets.tar.gz` 和 `.sha256` 檔傳到主機，執行 `sha256sum -c lumen-streets.tar.gz.sha256` 驗證後解壓縮。部署包包含建置好的網站與後端，在解壓目錄用 Node 24 執行 `npm start` 即可，不必安裝執行期 npm 套件。

## 接上網域

在同一台主機使用 HTTPS 反向代理或 Tunnel，將所有路徑轉送到 `http://127.0.0.1:5180`，並保留公開網址的 Host 標頭。

| `.env` 設定 | 值 |
| --- | --- |
| `LUMEN_PUBLIC_ORIGIN` | 完整來源網址，例如 `https://night.example.com`，不帶子目錄 |
| `LUMEN_HOST` | `127.0.0.1` |
| `PORT` | `5180` |
| `LUMEN_TRUST_PROXY` | 使用本機代理或 Tunnel 時設為 `1` |
| `LUMEN_PROXY_IP_HEADER` | 一般代理用 `x-lumen-client-ip`；直接接 Cloudflare Tunnel 用 `cf-connecting-ip` |
| `LUMEN_CACHE_DIR` | 可寫入、會保留的快取目錄，放在 `dist/` 以外 |

代理必須用經驗證的訪客 IP 覆寫所選標頭，才能分別計算每位訪客的請求額度。伺服器只信任來自 loopback 的連線；5180 不對外開放。直接在本機使用時，保留 `LUMEN_TRUST_PROXY=0`。

使用 [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/) 時，在 Node 主機執行 `cloudflared`，把公開網域指向 `http://127.0.0.1:5180`，並設 `LUMEN_PROXY_IP_HEADER=cf-connecting-ip`。若設定 HTTP Host Header 覆寫，請填公開網域。對外 HTTPS 由 Tunnel 提供。

HTML 採短期快取，`/api/*` 遵守伺服器的 `no-store`。搜尋端點與用量設定請看[地圖服務](PROVIDERS.md)。

## 持續運行與更新

用程序管理工具處理開機啟動與故障重啟。Linux 可參考 `deploy/lumen-streets.service` 和 `deploy/server.env.example`，依主機調整服務帳號、程式目錄、Node 執行檔及環境設定檔路徑。每個快取目錄只執行一個程序。

更新時替換程式檔、保留環境設定與快取，再重啟服務。保留上一份建置可供回退。

用另一台裝置打開公開網址，檢查預設地點、搜尋、跨城市移動、PNG／影片下載及 3D 分享連結。403 通常是 Host、來源網址或代理 IP 標頭不一致；429 代表請求額度或資料服務冷卻時間。

## 純靜態部署

將 `dist/` 的內容放到 HTTPS 靜態主機，即可使用 3D 編輯器、匯出和場景檔；預設地點也需要線上向量圖磚。沒有 API 時搜尋會隱藏。相對資源路徑支援子目錄，不需要 SPA fallback。

## 原始碼與授權

每次 `npm run build` 都會產生 `dist/lumen-streets-source.tar.gz`，包含這次建置所用的程式、建置腳本與文件。請連同 `dist/source.html`、`dist/license.txt` 和網站一起部署，讓訪客能取得對應版本的原始碼。更新修改版時，請重新建置並一併更新原始碼下載檔。原始碼封裝需要 `tar`（Ubuntu、macOS 與近期 Windows 均有提供）。
