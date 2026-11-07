# 原作者更新整合驗證

日期：2026-11-07（Asia/Taipei）。本次只在 `update-test` 整合，不推送、不合併回 main，也不部署容器。

## 來源

| 項目 | 版本 |
|---|---|
| 自訂穩定版／main | `89a9c93` |
| 共同基準 | `e80fcf8` |
| 原作者 upstream/main | `47af0e0`，2026-11-07 08:52:50 +08:00 |
| origin | toul999/time_tavern |
| upstream | NightSay2002/time_tavern |

開始時 main 與 origin/main 一致，工作目錄乾淨。從 main 建立 update-test，再 fetch upstream，使用非 squash、非 rebase 的 merge，保留雙方完整提交歷史。

## 保留與整合內容

- 保留自訂的多張 PNG／JPG／JSON 角色卡匯入、角色卡整份備份、data ZIP 匯出／匯入與手動重啟還原。
- 保留 root ENV 與 data/environment.env 的同步、啟動前還原、復原保護，以及既有服務重啟修正。
- 保留 Docker 程式映像、排除個人 data／ENV、無掛載部署，以及 agent 維護指引。
- 整合原作者的獨立模型 API 設定、Gemini 原生串流／思考與錯誤診斷、API 代理、計價與用量顯示、全局改詞、更新預設與 Discord／QQ 修正。
- 原作者將對話 API Key 租用／分組機制改為共享主 Key，獨立模型 API 使用其專用設定；保留這項上游設計，不把已移除的租用程式重新混入新版 API 路徑。

## 衝突與逐段檢查

| 檔案 | 雙方目的與處理 |
|---|---|
| README.md（文字衝突） | 本地是精簡修改摘要與部署入口；上游是最新功能、API 設定與使用說明。保留本地日期表與備份文件，補上本次上游摘要、詳細文件連結，以及 NovelAI 瀏覽器資料不在 data 備份內的提醒。未用上游整份覆蓋本地。 |
| src/public/index.html（文字衝突） | 雙方都更新 app.js 快取版本。改用共同的新版本參數；同時保留自訂匯入／備份按鈕與上游改詞介面及樣式更新。 |
| src/index.js（自動合併後覆查） | 上游改動模型、API 路由、計價及替換詞；本地新增備份路由與啟動／重啟保護。確認保留獨立備份路由、維護檢查，以及讀取 ENV 前套用 pending 的順序。原作者的新呼叫鏈與自訂備份功能並存。 |
| src/public/app.js（自動合併後覆查） | 上游變更 API 設定、價格與改詞；本地新增批量匯入及備份操作。保留雙方控制項、事件與流程，並驗證角色卡序列匯入及 data 手動重啟流程。 |
| scripts/start-with-update.js | 保留本地新增的還原前置處理、重啟環境快照與 Windows 命令視窗隱藏；沒有用新版入口跳過原本資料保護。 |
| package.json／package-lock.json | 接受上游 Node 最低版本與 undici 依賴更新，依鎖定檔重裝測試依賴。Docker 現有 Node 24 基礎環境符合需求，沒有修改正式映像。 |

自訂的 src/card-backup.js、src/data-backup.js、src/server-restart.js 與穩定版內容一致。

## 相容性修正

- 一批來源擷取測試以 LF 為分隔，Windows 的 CRLF 使函式擷取失敗，包含整合前已有的失敗。新增 .gitattributes 固定 JavaScript／HTML 為 LF，並將合併後的主要來源轉為 LF；不改變執行邏輯。
- 原作者的端到端測試在 Windows 建立 node_modules 目錄符號連結時遭 EPERM。Windows 改用 junction，其他平台仍用目錄符號連結。
- 擴充原作者的臨時服務測試，同時測試新 API／改詞與自訂備份，不連接真實模型、Bot 或正式資料。

## 驗證結果

合併前基準：278 項，272 通過、5 失敗、1 略過；使用 `node --test --test-isolation=none`。

整合修正與鎖定依賴安裝後，執行標準 `node --test`：

- 363 項測試，361 通過，0 失敗，2 略過。
- 略過項目：缺少 openssl 的 HTTPS 代理驗證，以及 Windows 無法執行的 macOS 啟動器安裝測試。
- 新增的端到端驗證包含：角色卡新增且 ID 不重複、備份還原不影響改詞設定、data 匯出／暫存、維護狀態、手動重啟，以及重啟後資料、角色卡與改詞設定還原。
- 相關 JavaScript 語法及 git diff --check 通過。
- `npm ci --ignore-scripts` 成功，該次 npm audit 回報 0 vulnerabilities。

這些是本機 Windows 與模擬 API 的測試結果，不代表已對真實模型供應商、macOS 或 Docker 部署進行完整實測。本次不重建或替換正式映像，不啟停正式容器，不讀取／遷移個人 data 或 ENV。

main 應維持 `89a9c93`。本分支的 merge commit 完成後，可用 `git log --graph --oneline main..update-test` 與 `git diff main...update-test` 檢視；由使用者確認後才決定是否合併回 main。
