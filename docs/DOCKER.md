# Docker：程式映像、啟動後匯入 data、不使用掛載

此方案只將程式、正式依賴與 defaults 包進映像，排除主機 data 與個人 ENV。首次啟動由程式初始化 /app/data，再從網頁匯入最新 ZIP；沒有匿名、具名或主機資料掛載。

## 初次建置及啟動

建置不讀取主機 data，舊服務可在建置期間繼續運作。切換服務前先匯出最終資料備份，停止舊服務以釋放 3234 埠；首次使用無須準備 data 或 .env。

在專案根目錄執行：

```powershell
docker compose up -d --build
```

本機開啟 `http://localhost:3234`。同區網裝置可用 `http://主機區網IP:3234`，主機防火牆須允許此埠。網頁包含密鑰及資料管理，請只開放給可信任的裝置；如果只要本機使用，將 Compose 的埠改為 `127.0.0.1:3234:3234`。

首次建置需要網路下載 Node.js 基礎映像與 npm 依賴。此設定使用 Linux 容器與 64 位元／ARM64 可用的 Node.js 官方映像，依建置主機平台選取。

## 設定與 `.env`

- 主機的 data 不會複製到映像；容器首次啟動會使用 defaults 建立初始資料。
- 根目錄 .env 與 environment.env 都不打包。匯入 data 並手動重啟後，會從匯入的 environment.env 還原容器根目錄 .env。
- 沒有環境備份時，可從網頁設定並儲存，自動生成 `.env` 和 data 內的備份。
- 不使用 `env_file`，不注入 API Key；也不需要掛載 `.env`。
- 容器使用非 root 的 node 帳號，已配置 `/app` 與資料目錄寫入權限。
- 容器內的 `PORT` 固定為 3234，優先於匯入環境檔的同名設定，避免跨裝置備份的舊埠讓服務無法存取。若主機需改用 8080，只改埠對應為 `8080:3234`。

## 日常重啟與匯入

```powershell
docker compose restart
```

重啟的是同一個容器，保留其中最新的資料，不會重新初始化既有 data。

匯入備份：

1. 網頁「全局設定 → 匯入 data」，選取 ZIP。
2. 等待驗證與暫存成功，服務進入維護狀態。
3. 執行 `docker compose restart`。
4. 程式啟動時先備份目前資料，再整份還原，之後重新整理網頁。

匯入採取代而非合併。舊資料備份位於容器內 `data/.data-transfer/before-restore-時間戳.zip`，也會隨容器刪除而消失；重要備份應下載到容器外保存。網頁匯出含環境密鑰、對話與圖片，未加密。ZIP／解壓容量限制見 README。

## 更新或搬到另一台裝置

**先匯出最新 data ZIP，再刪除或重建容器。** 執行中的修改保存在容器可寫層，不會寫回映像，也不會自動更新主機專案的 data。

建議流程：

1. 舊服務在網頁執行「匯出 data」，確認 ZIP 已下載。
2. 取得新程式後，執行 `docker compose up -d --build`，建立新容器。
3. 在新服務匯入剛下載的 ZIP，再執行 `docker compose restart`。

若新裝置不打算建置，可在來源裝置匯出映像：

```powershell
docker save -o time-tavern-image.tar time-tavern:local
```

目標裝置放置同一份 `compose.yaml`，載入映像後啟動：

```powershell
docker load -i time-tavern-image.tar
docker compose up -d --no-build
```

`docker save` 只包含程式映像，不包含容器的個人 data。最新資料仍須用網頁的 ZIP 匯出／匯入遷移。不同 CPU 架構的裝置需建置對應平台映像，不能假設任意映像能跨架構直接執行。

## 哪些動作會保留或丟失資料

| 動作 | 容器後來寫入的資料 |
|---|---|
| `docker compose stop` 再 `start` | 保留 |
| `docker compose restart` | 保留 |
| 單獨 `docker compose build` | 舊容器不變，但映像已更新 |
| `docker compose up` 且未重建容器 | 保留 |
| `docker compose up --build` 並因映像更新重建 | 舊容器資料不會自動移入新容器 |
| `docker compose down`／刪除容器 | 最新容器資料隨之移除 |

不要將 `down` 再 `up` 當成一般重啟使用。

## 打包內容與隱私

`.dockerignore` 採允許清單，僅加入套件描述檔、src 及 defaults，排除整個 data 與個人 ENV。排除本機 node_modules、Git、啟動器、Windows 右鍵工具、文件與測試。內部的 `data/.data-transfer` 不包入映像，避免舊待還原工作、日誌及回復檔影響新容器。

新建映像不包含個人 data 或 ENV。舊版曾包入 data 的映像仍可能保留密鑰，不能只重新標記就當成乾淨版本；分享前應確認映像來源。ZIP 備份仍屬私人資料。

## 檢查與日誌

先前含初始 data 的版本曾在本機完成映像建置與臨時容器驗證：非 root 寫入權限、ZIP 匯出／匯入、維護狀態、手動重啟後還原、環境檔還原與舊資料備份。臨時容器測試後已刪除；未啟動正式對外服務。

建置時 npm audit 回報現有依賴有 1 項 high 等級問題；本次沒有改動套件版本。正式公開部署前應另行檢查依賴公告與更新相容性。

```powershell
docker compose config
docker compose ps
docker compose logs --tail=100 time-tavern
```

程式直接執行 `node src/index.js`，不會使用 Git 自動更新。映像提供 HTTP 健康檢查；不健康不等於會自動重啟，重啟策略主要針對程序退出。

來源參考：[Docker 儲存說明](https://docs.docker.com/engine/storage/)、[Compose up 與容器重建](https://github.com/docker/compose/blob/main/docs/reference/compose_up.md)。
