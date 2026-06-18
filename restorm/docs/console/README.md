# Console

The Console is a workbench surface that re-renders every outbound network call as a copyable shell command. It shares the [firewall's](../firewall/README.md) interception layer — anything the firewall sees, the Console renders.

This is a developer-facing audit tool, not a security control. The block / allow decision happens in the firewall; the Console just shows what flowed (or was blocked).

## Where it lives

`View → Console` opens or focuses the singleton Console tab. The first time it opens it lands in a new tab group **below** every existing group, spanning the full workbench width. Subsequent opens just refocus — the tab persists across project reloads via the same workbench-tree persistence as every other tab.

Source code: [`restorm/src/renderer/src/components/Console/`](../../src/renderer/src/components/Console/).

## What gets rendered

Each captured request becomes one block of shell-styled output. The block contains:

- A header line with the **verb** (coloured: GET green, POST blue, PUT orange, DELETE red), the URL, the verdict (`allow` / `deny` / `pending`), and the source layer.
- The full shell command — `curl` by default, `Invoke-RestMethod` (PowerShell) when the toolbar is flipped.
- For non-HTTP protocols (gRPC, WebSocket), the command falls back to `grpcurl` / `wscat`. PowerShell mode prefixes those with `# No native PowerShell equivalent — reproducible Unix command:` so the user knows why they're seeing a Unix tool inside the PS pane.

The renderer is `xterm.js` (read-only — `disableStdin: true`). Add-ons:

- `@xterm/addon-fit` for resize.
- `@xterm/addon-search` for `Ctrl+F` inside the buffer.
- `@xterm/addon-web-links` so URLs in the rendered command are clickable.

ANSI colour codes are added by the Console once records are merged into the buffer — the formatters return plain command strings, the colourisation is applied per-record metadata at render time.

## Per-protocol formatters

The dispatcher in [`formatters/index.ts`](../../src/renderer/src/components/Console/formatters/index.ts) picks the right renderer based on `RequestRecord.protocol`:

| Protocol            | curl shell                                        | PowerShell shell                                  |
|---------------------|---------------------------------------------------|---------------------------------------------------|
| http / https        | `curl -X METHOD … -H … --data-raw …`              | `Invoke-RestMethod -Method … -Uri … -Headers $h`  |
| graphql             | (same family — HTTP shape)                        | (same family — HTTP shape)                        |
| soap                | (same family — HTTP shape)                        | (same family — HTTP shape)                        |
| odata               | (same family — HTTP shape)                        | (same family — HTTP shape)                        |
| grpc                | `grpcurl -plaintext -H … -d … host:port pkg.Svc/Method` | fallback to `grpcurl` with comment header   |
| websocket           | `wscat -c <url> -H …`                             | fallback to `wscat` with comment header           |

Wire-protocol detection runs at emission time in [`protocolDetect.ts`](../../electron-core-ui/src/main/services/firewall/protocolDetect.ts). It bumps records up from the base `http`/`https` to `graphql` / `soap` / `odata` / `grpc` based on URL patterns + content-type + body shape. Detection is conservative — anything ambiguous stays on the base scheme.

## Internal GraphQL filter

Restorm's renderer ↔ main bridge runs a GraphQL server on `http://localhost:<port>/graphql`. Every renderer ↔ main IPC call rides over that endpoint, so without a filter the Console would drown in plumbing chatter. Records hitting that origin are tagged `internal` at emission and **hidden by default** in the Console UI. The toolbar's "Show internal calls" toggle un-hides them for power users debugging the IPC layer itself.

## Click-through to the source request

Every `RequestRecord` carries a stable `id` (UUID minted at interception). Restorm's request executor sets `requestRefId` on records that come from a request tab. Clicking a Console block with a `requestRefId` opens (or focuses) the matching request tab — same as if you'd clicked the request in the sidebar.

If the source request was deleted between the call and the click, the line is dimmed and a one-shot warning toast explains why.

## Toolbar

- **Shell toggle** (`curl` ↔ `powershell`): global flip that re-renders the entire scrollback in the new format. Persisted in **app-level settings** (`restorm.console.requestFormat`), not per-project.
- **Clear** button: drops the in-memory buffer. The underlying records are untouched on the firewall side; the Console just stops showing them.

## Buffer

Rolling 10,000 lines. Older lines drop off the top; click-through still works as long as the underlying request still exists. The 10k limit is configurable via the same settings panel as the format toggle.

## Tests

- Per-protocol formatter snapshots: [`tests/unit/console/formatters.test.ts`](../../tests/unit/console/formatters.test.ts).
- E2E behavioural tests live under `tests/e2e/bdd/` (Console open / persistence / click-through).
