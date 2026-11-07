# 時分居酒屋：功能修改版

基於原專案 `e80fcf8`（2026-09-18）修改。

## 版本更新

| 日期 | 功能 |
| :--- | :--- |
| 2026-11-07 | 整合原作者最新版本：獨立模型 API、Gemini 原生串流與思考設定、API 代理及計價、全局改詞、預設與錯誤提示更新 |
| 2026-11-06 | 角色卡多選匯入、角色卡備份、data ZIP 備份還原、服務重啟修正、Docker 部署、Agent 維護指引 |

## 啟動

```sh
docker compose up -d --build
```

開啟 `http://localhost:3234`。完整步驟見 [Docker 部署說明](docs/DOCKER.md)。

**更新重建或刪除容器前，請先匯出最新 data；匯入後使用 `docker compose restart` 重啟同一容器。** data 備份含 API Key／Token，請妥善保管。

原專案介紹、圖片及本機啟動方式保留於 [README.bak.md](README.bak.md)。授權見 [LICENSE](LICENSE)，維護約定見 [AGENTS.md](AGENTS.md)。

原作者最新版本已整合至 `47af0e0`（2026-11-07）；API、Bot、改詞與模型設定見 [詳細文件](docs/DETAILS.md)。NovelAI 瀏覽器端歷史與參考圖草稿不在 data 備份範圍，搬移裝置時需另外保存。
