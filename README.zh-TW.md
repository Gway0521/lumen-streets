# <img src="public/favicon.svg" width="36" height="36" alt=""> Lumen Streets

**讓真實街道，亮成一幅會動的夜景。**

Lumen Streets 在瀏覽器裡，將 OpenStreetMap 的街道、建築與鐵路畫成動態夜景。選擇地點、調整光線，再匯出圖片或影片桌布。

[**線上體驗**](https://lumenstreets.feifeihome.com/?lang=zh-TW) · [English](README.md) · [開始使用](#開始使用) · [桌布匯出](docs/EXPORTS.md) · [參與開發](CONTRIBUTING.md)

![Lumen Streets 動態封面：札幌夜色與流動車燈](docs/images/social-cover.gif)

*札幌，依 OpenStreetMap 地圖繪製。封面動畫取自實際匯出影片。地圖資料 © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)，ODbL。*

## 留下你喜歡的夜色

- **從八個地點出發，也能搜尋自己的街區。** 札幌、東京新宿、台北信義與公館、上海外灘、北京東城、西雅圖與華盛頓特區。預載地圖不需要帳號或 API 金鑰。
- **有立體感的建築。** 航拍金夜以朝北的高角度視野呈現建築立面、屋頂與岸邊倒影。六個地標模型涵蓋台北 101、札幌電視塔與上海四座代表性高塔；琥珀夜與藍夜提供平面插畫風格。
- **為桌面而作。** 4K PNG、1080p／1440p 影片，支援桌面與直式取景。加入地點題記、顯示地標，或柔和壓暗一側留給圖示；預設不加品牌文字。
- **可以回到的場景。** 用場景檔保存取景與當下車流，也能分享播放器連結、嵌入自己的網站。

| 東京 · 新宿 | 上海 · 外灘 |
| --- | --- |
| ![東京密集街巷與鐵路](public/gallery/tokyo.png) | ![上海河岸與發光大道](public/gallery/shanghai.png) |

*實際匯出圖片。地圖資料 © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)，ODbL。*

[v0.2.0 更新內容](docs/releases/v0.2.0.md)：建築立體效果、六個地標模型、場景分享更新，以及依完整螢幕比例匯出桌布。

## 開始使用

在瀏覽器[開啟 Lumen Streets](https://lumenstreets.feifeihome.com/?lang=zh-TW)，選擇地點、調整光線，再匯出桌布。

### 在本機執行

安裝 [Node.js 24](https://nodejs.org/)，下載或 clone 專案後執行：

```sh
npm ci
npm run dev
```

開啟 **http://127.0.0.1:5180/**。選擇地點，用「調整」塑造光線，再到「匯出」取景、儲存。「靜看」會收起控制面板，按 Escape 即可返回。

「搜尋地點」可尋找街區並載入 1、2 或 4 公里範圍。隨附伺服器在開發與正式部署時都提供搜尋；公共地圖服務有使用額度，詳見[搜尋設定](docs/PROVIDERS.md)。

## 把夜景放到桌面

靜態桌布選 PNG；影片桌布可選 MP4，匯入 [Lively](https://github.com/rocksdanister/lively) 等桌布 App。影片長度為 15 秒至 5 分鐘，GIF 則用於分享短預覽。網站會確認瀏覽器支援的匯出格式。

想留位置給圖示或時鐘，可在匯出視窗打開「為圖示留白」，壓暗其中一側，再拖曳取景，留下喜歡的街道。地點題記與地標名稱都可自由開關。

詳見[匯出格式與設定](docs/EXPORTS.md)及[場景分享](docs/SCENES.md)。影片播放完畢後會直接接回開頭。

## 自行部署

```sh
npm run build
npm start
```

先停止開發伺服器，再啟動正式伺服器；兩者預設使用 5180。`npm start` 同時提供網站與搜尋。網域設定與打包上傳請看[部署指南](docs/HOSTING.zh-TW.md)。也可將 `dist/` 放到靜態主機，使用預載地圖與場景檔；這種模式下搜尋會隱藏。

畫面由 Canvas 2D 繪製，編輯器、匯出與播放器共用同一個場景引擎。地圖每次只載入一個區域，沒有帳號系統或追蹤分析。

## 參與開發

歡迎回報問題、補充翻譯，或提供讓繪圖效果遇到挑戰的街區。工程文件以英文維護：[參與開發](CONTRIBUTING.md)、[架構](docs/ARCHITECTURE.md)、[後續方向](docs/ROADMAP.md)、[瀏覽器相容性](docs/COMPATIBILITY.md)。

## 授權

程式採用 [AGPL-3.0-only](LICENSE)；地圖資料來自 [OpenStreetMap](https://www.openstreetmap.org/copyright)，採用 ODbL。公開分享匯出作品時，請附上地圖署名與授權連結；匯出視窗也可直接加入圖內署名。詳見[來源與授權](ATTRIBUTION.md)。

建築結合地圖高度、保守估算與原創地標造型；光線、車流與列車為藝術模擬，並非即時觀測。資料與模型的區別見 [建築說明](docs/BUILDINGS.md)。
