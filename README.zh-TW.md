# <img src="public/favicon.svg" width="36" height="36" alt=""> Lumen Streets

**把喜歡的城市，變成自己的動態夜景桌布。**

以 3D 視角探索街道，跟著流動的燈光，為螢幕留下一幅夜景。

[**線上試用**](https://lumenstreets.feifeihome.com/?lang=zh-TW) · [**Gallery**](https://lumenstreets.feifeihome.com/gallery.html#zh) · [文件](docs/README.zh-TW.md) · [English](README.md)

![Lumen Streets 中的上海黃浦江夜景](docs/images/social-cover.gif)

*由 Lumen Streets 渲染。地圖資料 © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)、[Overture Maps](https://docs.overturemaps.org/attribution/)；高度來源見[來源與授權](ATTRIBUTION.md)。*

## 做一幅自己的夜景

- **3D 探索:** 從精選城市開始，或搜尋喜歡的地點。平移、傾斜與旋轉，找到自己的視角。
- **動態車流:** 模擬車流讓夜景持續流動，從繁忙大道延伸至安靜水岸。
- **桌布構圖:** 選擇螢幕比例、加上地名，並壓暗一側為桌面圖示留白；可匯出靜態圖片或動畫。
- **保存分享:** 用場景檔保存視角與車流，分享視角連結，或將夜景嵌入網站。

## 40 秒，從城市到桌布

[![觀看紐約桌布操作示範](public/gallery/newyork-walkthrough.jpg)](https://lumenstreets.feifeihome.com/gallery.html#walkthrough-zh)

[**▶ 觀看操作示範**](https://lumenstreets.feifeihome.com/gallery.html#walkthrough-zh) · [下載 MP4](public/gallery/newyork-walkthrough.mp4)

探索下曼哈頓、顯示地標名稱、調整桌布構圖，再匯出 PNG。採高畫質設定，以 1080p 錄製，附中英操作提示，無音訊。

## 放到你的桌面

[![上海夜景作為 Windows 桌布，App 圖示排列在左側壓暗區域](docs/images/shanghai-desktop.png)](docs/images/shanghai-desktop.png)

*上海・黃浦江的 Windows 桌面使用實例。左側壓暗讓圖示保持清楚。[下載 4K 桌布](public/gallery/shanghai-wallpaper.png)，或[探索精選城市](docs/SHOWCASE.zh-TW.md)。*

套用方式見[桌布指南](https://lumenstreets.feifeihome.com/wallpapers.html#zh)，格式與尺寸見[匯出選項](docs/EXPORTS.md)。

## 本機執行

安裝 **Git**、**Node.js 24**、**Python 3.12**（含 pip 與 venv），執行：

```sh
git clone https://github.com/Gway0521/lumen-streets.git
cd lumen-streets
npm ci
npm run dev
```

開啟 **http://127.0.0.1:5180/** 。首次啟動會為建築資料處理建立獨立 Python 環境。自行架站請依[部署指南](docs/HOSTING.zh-TW.md)操作。

訪客需要支援 WebGL2 的瀏覽器與網路連線。建築高度可能包含估算；光線與車流為藝術模擬。詳見[瀏覽器相容性](docs/COMPATIBILITY.md)與[建築資料](docs/BUILDING-HEIGHTS.zh-TW.md)。

## 文件與貢獻

[文件索引](docs/README.zh-TW.md)涵蓋桌布設定、場景保存、部署與開發。歡迎回報問題、改善翻譯或投稿地標模型；請從[貢獻指南](CONTRIBUTING.md)開始。版本變更見 [v0.3.0 更新說明](docs/releases/v0.3.0.md)。

## 授權

程式採 [AGPL-3.0-only](LICENSE)，OpenStreetMap 資料採 [ODbL](https://www.openstreetmap.org/copyright)。公開分享匯出作品時請保留來源署名，詳見[來源與授權](ATTRIBUTION.md)。
