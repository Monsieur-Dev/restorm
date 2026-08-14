# Changelog

## v1.0.1

**首個修補：側邊欄拖曳、分頁名稱與當機報告。**

- **在側邊欄移動項目不再讓應用程式壞掉。** 開啟迷你瀏覽器、設定或 MCP 記錄時，在側邊欄拖曳任何一列都會讓介面崩塌，只有重新啟動才能復原。
- **重新命名項目現在會更新每個開啟的分頁** — 包括分割窗格中的分頁，以及所有請求類型（gRPC、GraphQL、Redis 等）的分頁；先前它們會保留舊名稱直到重新開啟。
- **當機報告重新送達我們。** 即使開啟報告傳送，1.0.0 也悄悄什麼都沒送出：你遇到的當機沒有告訴我們任何事。
- **「程式語言」提示插圖重新顯示各語言標誌。**

## v1.0.0

**Restorm 1.0 —— 本地優先的 API 用戶端，正式發布。**

Restorm 是一款快速、離線優先的桌面用戶端，可在所有主流協定上測試並驅動 API。

- **協定**：REST/HTTP、GraphQL、gRPC、WebSocket、SSE、SOAP、OData、MQTT、AMQP、STOMP、Kafka、Redis、tRPC、JSON-RPC。
- **情境**：以視覺化方式串接請求，分支/迴圈，擷取並重複使用數值，在 CI 中以無介面模式執行。
- **環境與變數**：隨處可用的 `{{handlebars}}`、具型別的密鑰、依資料夾劃分的環境。
- **匯入/匯出**：OpenAPI、Postman、Insomnia、HAR、WSDL、GraphQL SDL、OData EDMX、curl、程式碼匯出。
- **Git 原生專案**：你的 `.restorm` 專案就是一個普通檔案——進行版本控制、比較差異，並在應用程式內解決衝突。
- **本地優先且私密**：一切都在你的電腦上執行；輸出防火牆會攔截每一次外部呼叫。
- **跨平台**：Windows、macOS、Linux（.deb/.rpm/AppImage）+ npm。

免費的 Community 版，並為團隊提供 Pro 與 Enterprise。
