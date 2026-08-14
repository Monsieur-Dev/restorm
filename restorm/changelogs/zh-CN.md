# Changelog

## v1.0.1

**首个补丁：侧边栏拖动、标签名称与崩溃报告。**

- **在侧边栏移动条目不再让应用崩溃。** 打开迷你浏览器、设置或 MCP 日志时，在侧边栏拖动任意一行都会让界面崩塌，只能重启才能恢复。
- **重命名条目现在会更新所有已打开的标签页** — 包括分屏面板中的标签页，以及所有请求类型（gRPC、GraphQL、Redis 等）的标签页；此前它们会保留旧名称直到重新打开。
- **崩溃报告重新送达我们。** 即便开启了报告发送，1.0.0 也在无声中什么都没发送：你遇到的崩溃没有告诉我们任何信息。
- **“代码语言”提示插图重新显示各语言标志。**

## v1.0.0

**Restorm 1.0 —— 本地优先的 API 客户端，正式发布。**

Restorm 是一款快速、离线优先的桌面客户端，可在所有主流协议上测试和驱动 API。

- **协议**：REST/HTTP、GraphQL、gRPC、WebSocket、SSE、SOAP、OData、MQTT、AMQP、STOMP、Kafka、Redis、tRPC、JSON-RPC。
- **场景**：可视化串联请求，分支/循环，提取并复用值，在 CI 中无界面运行。
- **环境与变量**：随处可用的 `{{handlebars}}`、类型化机密、按文件夹划分的环境。
- **导入/导出**：OpenAPI、Postman、Insomnia、HAR、WSDL、GraphQL SDL、OData EDMX、curl、代码导出。
- **Git 原生项目**：你的 `.restorm` 项目就是一个普通文件——对其进行版本管理、比较差异，并在应用内解决冲突。
- **本地优先且私密**：一切都在你的机器上运行；出站防火墙会拦截每一次外部调用。
- **跨平台**：Windows、macOS、Linux（.deb/.rpm/AppImage）+ npm。

免费的 Community 版，并为团队提供 Pro 与 Enterprise。
