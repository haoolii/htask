# htask

`htask` 為每個任務建立獨立 Docker 容器與 OpenCode session。它接受任意文字 prompt，不限於 PR review。

`run` 啟動容器內的背景程序後就輸出 `OK` 和 run ID，不等待 OpenCode 回覆。背景程序建立 session，並送出 prompt 請求執行。

## 建立任務

安裝 Node.js 22 至 24，並啟動 Docker Engine。Windows 請使用 Docker Desktop 的 Linux 容器，並在 Git Bash 中執行 `./htask`。在 PowerShell 中，以 `node cli.js` 替換 `./htask`。

## 設定 OpenCode

把現有的 OpenCode 設定存成 `htask` 指令同目錄的 `opencode.jsonc`，或把 `opencode.example.jsonc` 複製成 `opencode.jsonc` 再編輯。新任務會把它唯讀掛載到容器的 `/workspace/opencode.jsonc`，由 OpenCode 直接載入。設定變更不需要重建映像。沒有這個檔案也能建立任務。

本機的 `opencode.jsonc` 已設定預設模型為 `benny-spark/qwen3:30b`。容器必須能連到設定中的 DGX Spark API。也可在同一個檔案設定其他供應商或 MCP。例如：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "model": "openai/gpt-6.1-sol",
  "providers": {
    "openai": {
      "settings": { "apiKey": "{env:OPENAI_API_KEY}" }
    }
  }
}
```

路徑和指令以容器為準。htask 只掛載這一個設定檔，不會複製主機的 OpenCode 登入資料或掛載其他檔案。

### 用 `.env` 提供金鑰

將 `.env.example` 複製成同目錄的 `.env`，只填需要的金鑰。例如：

```dotenv
OPENAI_API_KEY=你的金鑰
```

支援的金鑰名稱列在 `.env.example`。`OPENCODE_API_KEY` 用於 OpenCode Zen 或 Go。有 `opencode.jsonc` 時，以該檔案選模型。沒有該檔案時，`.env` 的 `OPENCODE_MODEL` 可指定新 session 的模型。已啟動的容器不會載入新的 `.env`。登入 ChatGPT 或 GitHub Copilot 仍需用 `attach` 進入該任務，再執行 OpenCode 的 `/connect`。

`.env` 和 `opencode.jsonc` 都排除在 Git 與 Docker 建置內容之外。請把金鑰留在 `.env`，不要直接寫入 JSONC。Docker 管理員與容器內程序仍可能讀取金鑰，請用專用、限權的金鑰，不要用於不可信的任務。

## 執行任務

在本目錄建置映像並建立任務。更新程式後，重新建置映像再建立新任務：

```sh
docker build -t htask:dev .
./htask task run '幫我檢查這個專案的測試設定'
```

容器不會隨 CLI 結束而停止。用 `status` 查看 session ID、送出進度或錯誤。`prompt-accepted` 只表示 OpenCode 接收請求，不代表 AI 已完成。

## 使用 Playwright MCP

新任務預設啟用 Playwright MCP。建置時會下載 Chromium；既有容器不會更新。重新建置後，可以這樣建立任務：

```sh
docker build -t htask:dev .
./htask task run '啟動專案後，用 Playwright 開啟容器內的測試頁，截圖保存到 artifacts/home.png。'
```

Chromium 在容器內以 headless 模式執行，使用獨立瀏覽器狀態，不連主機 Chrome。截圖的預設輸出目錄是 `/workspace/artifacts`。若指定檔名，請用 `artifacts/home.png`，以便在本機看到。用 `attach` 進入任務後，可在 OpenCode 輸入 `/mcps` 查看 `playwright` 的連線狀態。

Playwright 設為 `"codemode": false`，讓 `playwright_browser_take_screenshot` 等工具直接提供給模型，不必先搜尋工具。如果本機 `opencode.jsonc` 有覆寫 `mcp.servers.playwright`，也要在該項設定中保留 `"codemode": false`。

瀏覽器操作會錄成 WebM。先截圖，再呼叫 `playwright_browser_close` 正常關閉瀏覽器，讓錄影寫入 `.runs/<RUN_ID>/artifacts/`。不要先停止或刪除容器。錄影從頁面開啟時開始，不需要另外呼叫錄影工具。若覆寫 Playwright MCP 的啟動命令，請保留 `--config /opt/htask/playwright.json`。

如果改用 Playwright CLI，截圖檔名是第二個位置參數，不是 `--output`。在新版容器內可直接用映像已安裝的 Playwright，不必透過 `npx` 下載：

```sh
node /usr/local/lib/node_modules/@playwright/mcp/node_modules/playwright/cli.js screenshot \
  --channel=chromium http://localhost:8000 /workspace/artifacts/screenshot.png
```

## 查看任務輸出

在 prompt 裡指定輸出到 `/artifacts`：

```sh
./htask task run '完成後把結果寫到 /artifacts/report.md'
```

容器中的 `/artifacts/` 和 `/workspace/artifacts/` 都指向本機的 `.runs/<RUN_ID>/artifacts/`。因此，在預設工作目錄 `/workspace` 下用相對路徑 `artifacts/` 寫入也可以。`run` 會印出本機完整路徑，`cleanup` 不會刪除這個目錄。對於沒有掛載對應路徑的舊容器，請在清理前用 `docker cp` 取出檔案。

## 管理任務

用 `./htask help` 或 `./htask task --help` 查看指令清單。

將範例 run ID 換成建立任務時輸出的值。

```sh
./htask task ls
./htask task status task-0123456789abcdef
./htask task logs task-0123456789abcdef
./htask task shell task-0123456789abcdef
./htask task exec task-0123456789abcdef ls -la /workspace
./htask task attach task-0123456789abcdef
./htask task abort task-0123456789abcdef
./htask task cleanup task-0123456789abcdef
./htask task gc --dry-run
```

`attach` 會打開既有的 OpenCode session。只想進容器時，用 `shell` 或不帶命令的 `exec` 開啟 Bash。帶命令的 `exec` 會直接在容器內執行，不會開啟 OpenCode。

`shell` 和 `attach` 需要互動式終端機。`abort` 停止 AI turn，不保證停止容器內其他程序。`cleanup` 刪除容器，保留本機任務紀錄及已寫到本機的 artifacts。`gc --dry-run` 只列出建立逾四小時的未清理任務，不會刪除資源。`finish` 尚未實作。

`.runs/` 是本機執行資料，包含 OpenCode server 密碼，不會進入 Git 或 Docker 建置內容。不要分享此目錄，或在共用主機上執行。容器網路出口尚未限制，請勿放入機密資料或正式憑證。

## 清理本機任務紀錄

```sh
./htask task clean --dry-run
./htask task clean
```

`clean` 只刪除已執行 `cleanup`、且容器已不存在的任務目錄。預設跳過有 artifacts 或其他未識別檔案的目錄。它不會停止或刪除容器。

若確定也要永久刪除符合條件的 artifacts，使用 `./htask task clean --include-artifacts`。可加上 `--dry-run` 先查看會刪除哪些任務目錄。

若要停止並移除所有 htask 容器，同時永久刪除對應的本機紀錄及 artifacts，使用：

```sh
./htask task clean --all --dry-run
./htask task clean --all
```

`--all` 也會移除正在執行的 htask 容器。它不會移除其他 Docker 容器或映像，也會保留 `.runs/` 中無法辨識的目錄。清理期間不要啟動新任務。

## 任務狀態

`ls` 和 `status` 每次執行時會重新查詢 Docker 和背景程序，畫面不會自動刷新。

| 狀態 | 意義 |
| --- | --- |
| `provisioning` | 容器已啟動，CLI 正在準備 prompt 並啟動背景程序。 |
| `background-started` | CLI 已啟動背景程序，但還沒有讀到程序回報的狀態。 |
| `waiting-for-server` | 背景程序正在等待 OpenCode server 就緒。 |
| `submitting-prompt` | session 已建立，背景程序正在等待 OpenCode 確認收到 prompt。 |
| `prompt-accepted` | OpenCode 已接受 prompt。即使 AI 已回答，htask 仍會停在這個狀態。 |
| `error` | 啟動背景程序、建立 session 或送出 prompt 時發生錯誤。容器可能仍在執行。 |
| `stopped` | Docker 顯示容器已退出或無法運作。容器仍存在。 |
| `missing` | Docker 找不到對應容器，例如容器已在 htask 外部被移除。 |
| `destroyed` | `cleanup` 已移除容器，但本機任務紀錄仍保留。 |

容器暫停或重啟時，會直接顯示 Docker 的狀態，例如 `paused` 或 `restarting`。`status` 中的 `containerState: "running"` 只表示容器在執行，不代表 AI 正在執行。目前沒有 `completed` 狀態。要確認 AI 是否已回答，在容器執行時用 `attach` 查看同一個 session。

## 執行測試

```sh
node --test
```
