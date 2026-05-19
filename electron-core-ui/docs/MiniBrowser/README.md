# MiniBrowser

An embedded, process-isolated web browser panel for Electron apps — address bar, back/refresh, and an Electron `<webview>` guest. Built for hosting third-party SPAs (login flows, dashboards) inside the app without the cookie/storage partitioning a cross-site `<iframe>` suffers.

## Overview

`MiniBrowserPanel` renders a minimal browser chrome over an Electron [`<webview>`](https://www.electronjs.org/docs/latest/api/webview-tag) tag. Unlike a plain `<iframe>`, a `<webview>` gets its own top-level browsing context, so cookies / `localStorage` / IndexedDB behave exactly as they would in a real browser tab — login forms that silently persist a JWT work.

The panel is fully controlled on its URL: it loads `initialUrl` on mount and pushes every committed navigation back through `onUrlChange`, so the host owns persistence (e.g. restoring the last page when a workbench tab reopens).

The companion `useMcpMiniBrowserBridge` hook wires the ECUI MCP tools (`open_mini_browser`, `mini_browser_execute`) into the renderer — see [MCP integration](#mcp-integration).

## Installation

```typescript
import { MiniBrowserPanel, useMcpMiniBrowserBridge } from 'electron-core-ui/renderer'
import type { MiniBrowserPanelProps, MiniBrowserBridgeApi } from 'electron-core-ui/renderer'
```

## `MiniBrowserPanel`

```tsx
<MiniBrowserPanel
  initialUrl={tab.url}
  onUrlChange={(url) => persistUrlOnTab(tab.id, url)}
/>
```

### Props

| Prop | Type | Description |
|---|---|---|
| `initialUrl` | `string \| undefined` | URL the webview loads on mount. Omit for the empty "enter an address" placeholder. |
| `onUrlChange` | `(url: string) => void` | Called after a committed navigation — manual address-bar submit, link click, SPA route change (`history.pushState`), refresh, or back. **Not** called on every keystroke. Use it to persist the page on the host's tab. |

### Behaviour notes

- **Address normalisation** — bare hosts are scheme-completed: `example.com` → `https://example.com`, `localhost:3000` / `127.0.0.1` / `0.0.0.0` → `http://…`. Anything with an explicit scheme passes through verbatim.
- **History** — the toolbar's Back button uses the webview's own navigation history (`canGoBack` / `goBack`); there's no manual URL stack.
- **No popups** — the webview omits `allowpopups`, so `window.open` from the guest is swallowed (there's no chrome to host a popup). Users paste the URL into the address bar instead.
- The webview element carries `data-testid="mini-browser-iframe"` — the MCP bridge's default `webviewSelector`.

## `useMcpMiniBrowserBridge`

Subscribes to the MCP Mini browser IPC channels and runs the renderer-side side-effects. The hook is host-agnostic — it never reaches for a specific `window.*` namespace; the host injects the IPC `bridge`.

```tsx
useMcpMiniBrowserBridge({
  enabled: mcpEnabled,
  bridge: window.myApp?.runtime,          // satisfies MiniBrowserBridgeApi
  openMiniBrowser: handleOpenMiniBrowserTab,
  setMiniBrowserUrl: setMiniBrowserTabUrl
})
```

### Input (`UseMcpMiniBrowserBridgeInput`)

| Field | Type | Description |
|---|---|---|
| `enabled` | `boolean` | When `false`, the hook no-ops (no subscriptions). |
| `bridge` | `MiniBrowserBridgeApi \| null \| undefined` | IPC bridge object. `null`/`undefined` no-ops cleanly (preload not wired, or non-Electron context). |
| `openMiniBrowser` | `() => void` | Invoked on `open_mini_browser`. The host owns the tab-tree mutation; the hook just forwards. |
| `setMiniBrowserUrl` | `(url: string) => void` | Invoked (after a render tick) when `open_mini_browser` carries a `url`. Persists the URL on the host's tab so the webview navigates. |
| `webviewSelector` | `string \| undefined` | CSS selector for the `<webview>` element. Defaults to `[data-testid="mini-browser-iframe"]` (what `MiniBrowserPanel` emits). |

### `MiniBrowserBridgeApi`

The shape the host must provide as `bridge` — three methods mapping to the ECUI Mini browser channels:

```typescript
interface MiniBrowserBridgeApi {
  onMcpOpenMiniBrowser(cb: (payload: { url?: string }) => void): () => void
  onMcpMiniBrowserExecute(cb: (payload: { requestId: string; code: string }) => void): () => void
  replyMiniBrowserExecute(payload: { requestId: string; result?: unknown; error?: string }): void
}
```

The host's preload typically implements these over the channel-name constants in `electron-core-ui/types` — `MINI_BROWSER_OPEN_CHANNEL`, `MINI_BROWSER_EXECUTE_CHANNEL`, `MINI_BROWSER_EXECUTE_REPLY_CHANNEL`.

## MCP integration

`McpService` registers two built-in tools for the Mini browser:

- **`open_mini_browser`** — broadcasts `MINI_BROWSER_OPEN_CHANNEL` to open / focus the panel, optionally with a `url`.
- **`mini_browser_execute`** — broadcasts `MINI_BROWSER_EXECUTE_CHANNEL` with a request id, waits for the renderer's reply on `MINI_BROWSER_EXECUTE_REPLY_CHANNEL`, and returns the script result. Runs the code in the webview *guest* context (via `webview.executeJavaScript`), not the host renderer.

For these to work the host must: (1) render `MiniBrowserPanel` somewhere, (2) call `useMcpMiniBrowserBridge` with a wired `bridge`, (3) expose the three bridge methods from its preload over the ECUI channel constants. See `McpService`'s doc for the tool surface.

## Wiring checklist for a consuming app

1. Render `<MiniBrowserPanel initialUrl=… onUrlChange=… />` in a tab / panel.
2. In preload, subscribe `onMcp*` to the `MINI_BROWSER_*_CHANNEL` constants and expose them on your `window.<app>` namespace.
3. In the renderer, call `useMcpMiniBrowserBridge` with `bridge` pointing at that namespace slice.
4. `McpService` already registers the tools — nothing to do on the main side beyond starting the service.
