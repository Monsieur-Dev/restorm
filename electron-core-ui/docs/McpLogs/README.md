# McpLogs

A generic, host-agnostic viewer for the **served-MCP-call buffer** that
`McpService` retains in the main process. Renders each locally-executed
`tools/call` as a scannable chat-style row — tool name, timestamp, request +
response payloads — with any captured screenshot / screencast shown inline.
Media is rendered as the actual image / video (via the ECUI
[`Thumbnail`](../Thumbnail/README.md)), never as a raw base64 blob: when a
call produced a capture, its unreadable base64 response text is suppressed and
the Thumbnail stands in as the response — click to enlarge, right-click to
copy. Mount it as a workbench tab body or inside a modal.

The component carries **no copy** — every label is injected via
`McpLogsLabels` so it stays project-neutral (ECUI isolation). It also carries
no IPC: the host wires a data source once at bootstrap via
`registerMcpLogsSource`, and the viewer pulls snapshots from it.

## Data flow

```
main: McpService ring buffer  (getServedCalls / onServedCall / clearServedCalls)
        │  (host IPC: e.g. window.<app>.runtime.getMcpLogs / onMcpLogsChanged / clearMcpLogs)
        ▼
renderer: registerMcpLogsSource(source)   ← call once at bootstrap
        ▼
<McpLogsPanel labels={…} />   ← pulls via useMcpLogsFeed()
```

`McpService` records only calls it executes **locally** — a request the
cross-instance bridge forwards to a peer is never recorded — so the viewer
shows just this instance's traffic.

## API

### `McpLogsPanel`

| Prop | Type | Notes |
|------|------|-------|
| `labels` | `McpLogsLabels` | Localized strings (required — see below). |
| `data-testid` | `string` | Defaults to `mcp-logs-panel`. |

### `registerMcpLogsSource(source: McpLogsSource)`

Wire the viewer to the host IPC once at renderer bootstrap.

```ts
interface McpLogsSource {
  getLogs(): Promise<McpLogEntry[]>   // newest-first snapshot
  onChange(cb: () => void): () => void // returns an unsubscribe fn
  clear?(): Promise<void> | void       // omit to hide the Clear button
}
```

### `useMcpLogsFeed()`

Hook used internally by the panel; exported for custom surfaces. Returns
`{ entries, loading, hasSource, canClear, refresh, clear }`.

### `McpLogEntry`

```ts
interface McpLogEntry {
  timestamp: number
  tool: string
  payload: string           // request args, JSON-stringified + truncated
  payloadTruncated: boolean
  payloadBytes: number      // original byte length before truncation
  response?: string         // tool result, JSON-stringified + truncated
  responseTruncated?: boolean
  capture?: McpLogCapture   // present for screenshot / screencast tools
}
```

### `McpLogsLabels`

`title`, `empty`, `clear`, `tool`, `time`, `payload`, `truncated`,
`screenshot`, `screencast`, `captureEvicted`, `copy` (media right-click Copy),
`closePreview` (enlarged-media close) — all required.

## Example

```tsx
import { McpLogsPanel, registerMcpLogsSource } from 'electron-core-ui/renderer'

// bootstrap (once)
registerMcpLogsSource({
  getLogs: () => window.myApp.runtime.getMcpLogs(),
  onChange: (cb) => window.myApp.runtime.onMcpLogsChanged(cb),
  clear: () => window.myApp.runtime.clearMcpLogs()
})

// somewhere in the workbench / a modal
<McpLogsPanel labels={t.mcpLogs} />
```
