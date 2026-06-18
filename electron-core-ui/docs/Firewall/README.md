# Firewall

A generic outbound-network firewall for Electron apps: it intercepts every outbound HTTP / HTTPS / fetch call at a low level, classifies the destination against allow / deny rules, and prompts the user for unknown destinations — so a compromised npm dependency can't quietly exfiltrate data through a supply-chain attack.

## Overview

The firewall gates **destinations** (a `(scheme, host, port)` triple), not content. It has two interception layers + a permission model + a renderer UI, all reusable. The host app keeps only its **configuration** — there are no app-specific values baked into the engine.

- **Layer A — `firewallService`** wraps Chromium's `session.defaultSession.webRequest.onBeforeRequest`. It captures renderer-context traffic (fetch / XHR / WebSocket upgrade / subresource loads), routes each through the permission model, and allows or cancels.
- **Layer B — `installMainProcessInterceptor()`** monkey-patches `http.request` / `https.request` / `globalThis.fetch` **in the main process**, so a dependency that phones home from main-process code is captured too. Install it as early as possible (before any module can make an outbound call).
- **`permissionService`** holds the rule model: a persisted whitelist + blacklist, a project-derived origin set, the host app's infra-port exemptions, and the pending-prompt queue. A `classify()` returns `allow` / `deny` / `prompt` synchronously; `check()` resolves the async prompt.
- **`installWorkerPatcher()`** injects a deny-everything bootstrap into spawned `worker_threads.Worker` / `child_process.fork` children (defensive — those V8 contexts wouldn't inherit Layer B's patches).
- **Renderer UI** — `FirewallPanel` (admin: whitelist / blacklist editor) + `useFirewallPromptToasts` (surfaces each pending decision as an Allow/Deny toast).

Verdicts persist to `<userData>/firewall/state.json`. Allowing an origin adds it to the whitelist; denying adds it to the blacklist. Timeouts / no-renderer / shutdown resolve the in-flight request as `deny` **without** persisting a rule.

## Installation

```typescript
// Main process
import {
  installMainProcessInterceptor,
  configureFirewall,
  firewallService,
  permissionService,
  registerFirewallIpc,
  installWorkerPatcher
} from 'electron-core-ui'

// Renderer
import { FirewallPanel, useFirewallPromptToasts } from 'electron-core-ui/renderer'

// Shared types (also re-exported from the main + renderer barrels)
import type { FirewallOrigin } from 'electron-core-ui/types/firewall'
```

## Main-process wiring

```typescript
// 1) BEFORE any other import that might make an outbound call, configure
//    the app-specific bits and arm the interceptor.
configureFirewall({
  // Skip an in-process bridge endpoint from interception + the audit
  // feed (optional). Lazy so a port chosen at boot is picked up.
  internalEndpointProvider: () => graphQLService.getEndpoint(),
  // Filename prefix for the worker-bootstrap temp file (optional).
  workerBootstrapPrefix: 'my-app-firewall-bootstrap',
  // Auto-allow everything (optional) — for e2e harnesses against
  // ephemeral mock servers that can't be whitelisted ahead of time.
  e2eBypass: process.env['MY_APP_E2E'] === '1',
  // Exempt the app's own internal infrastructure traffic from gating
  // (optional). Receives the raw http.request arg list so the app can
  // recognise, e.g., a loopback call carrying an app-private routing
  // header. Unset → nothing is treated as internal.
  internalRequestPredicate: (args) => carriesMyInternalHeader(args)
})
installMainProcessInterceptor()

// 2) At app.whenReady():
firewallService.registerWebRequestListener()  // Layer A
registerFirewallIpc()                          // renderer ↔ main control plane
installWorkerPatcher()                          // worker / fork isolation

// 3) Tell the firewall about your own localhost infra ports so internal
//    plumbing is auto-allowed (only these exact ports — not all of
//    localhost). Set a slot to null to disable that auto-allow.
permissionService.setInfraPorts({ graphqlPort, viteDevPort })
// …and later, once an embedded MCP server binds:
permissionService.setInfraPorts({ mcpPort })

// 4) On shutdown, resolve any open prompt so the IPC bridge has no
//    dangling promises.
app.on('before-quit', () => { permissionService.denyAllPending() })
```

### Preload bridge

The renderer UI talks to the main process through `window.api.firewall.*`. Wire those in your preload using the exported IPC channel constants:

```typescript
import {
  FIREWALL_IPC,
  FIREWALL_REQUEST_RECORD_CHANNEL,
  type FirewallOrigin,
  type FirewallPromptPayload
} from 'electron-core-ui/types/firewall'

// expose: onRecord, listWhitelist/addToWhitelist/removeFromWhitelist,
//         listBlacklist/addToBlacklist/removeFromBlacklist,
//         setProjectOrigins, onPromptShow, resolvePrompt
```

## Renderer wiring

```tsx
// Mount the admin panel somewhere in your workbench:
<FirewallPanel appName="My App" testButtonFeature="firewall.testButton" />

// Subscribe to permission prompts once, near the app root:
function App() {
  useFirewallPromptToasts()
  // …
}
```

`appName` is interpolated into the panel's intro copy ("<appName> intercepts every outbound …"); when omitted it falls back to "This application". No app name is baked into the component.

The project-derived origin set (origins extracted from the open project, so a saved request to a known host doesn't prompt) is pushed from the renderer via `window.api.firewall.setProjectOrigins(origins)`. Building that `FirewallOrigin[]` from the host app's own document model stays in the host app — the firewall only consumes the resulting array.

## API

### `configureFirewall(config: FirewallConfig): void`

Injects the host app's decisions into the generic engine. Call once at boot, before `installMainProcessInterceptor()`.

```typescript
interface FirewallConfig {
  /** Lazy provider for an in-process bridge endpoint to skip from
   * interception + the audit feed. Unset → nothing is treated as
   * internal (the engine makes no GraphQL-bridge assumption). */
  internalEndpointProvider?: (() => string) | null
  /** Auto-allow every outbound call. Default false. */
  e2eBypass?: boolean
  /** Worker-bootstrap temp-file prefix. Default 'ecui-firewall-bootstrap'. */
  workerBootstrapPrefix?: string
  /** Predicate over the raw http(s).request arg list that flags a
   * request as the host app's internal infrastructure traffic (e.g. a
   * loopback call carrying an app-private routing header). True →
   * auto-allow + emit for audit, no prompt. Never throws (a throwing
   * predicate is treated as "not internal"). Unset → nothing internal. */
  internalRequestPredicate?: ((args: unknown[]) => boolean) | null
}
```

`resetFirewallConfig()` reverts to defaults (test-only convenience).

### `firewallService`

- `registerWebRequestListener(): void` — install Layer A (idempotent).
- `emit(record: RequestRecord): void` — push a record to subscribers (used by Layer B).

### `permissionService`

- `classify(input: CheckInput): 'allow' | 'deny' | 'prompt'` — synchronous verdict.
- `check(input: CheckInput): Promise<'allow' | 'deny'>` — resolves a prompt.
- `listWhitelist() / listBlacklist(): FirewallOrigin[]`
- `addToWhitelist / removeFromWhitelist / addToBlacklist / removeFromBlacklist(origin)`
- `setProjectOrigins(origins: FirewallOrigin[]): void`
- `setInfraPorts(patch: Partial<InfraPorts>): void` / `getInfraPorts(): InfraPorts`
- `listPendingPrompts(): PendingPromptSnapshot[]`
- `resolvePrompt(promptId, verdict, persist = true): void`
- `denyAllPending(): void`

```typescript
interface InfraPorts { graphqlPort: number | null; mcpPort: number | null; viteDevPort: number | null }
```

### Installers

- `installMainProcessInterceptor(): void` — Layer B (idempotent).
- `installWorkerPatcher(): void` — worker / fork deny-bootstrap (idempotent).
- `installHardenInterceptor(): void` — deeper `net.Socket` / dns / dgram lockdown. **Experimental — not wired by default** (interacts poorly with undici's socket path).
- `registerFirewallIpc(): void` — installs the renderer ↔ main control-plane handlers (idempotent).

### Bypass

- `withFirewallBypass(fn)` — run `fn` with outbound traffic pre-authorised (for user-initiated calls the firewall shouldn't gate, e.g. a request the user explicitly clicked Run on). Emitted as an `allow` record for the audit feed, no verdict roundtrip.
- `isFirewallBypassed(): boolean` — current bypass state.

### Renderer

- `FirewallPanel` — admin panel. Props: `appName?`, `testButtonFeature?`, `data-testid?`.
- `useFirewallControl()` / `refreshFirewallControl()` — read/mutate the rule lists from React.
- `useFirewallPromptToasts()` — subscribe to prompts + render Allow/Deny toasts.
- `FirewallPromptBody` — the toast body component.

### Shared types

`FirewallOrigin`, `FirewallPromptPayload`, `FirewallPromptResolution`, `RequestRecord`, `RequestRecordSource`, `RequestRecordVerdict`, `RequestRecordProtocol`, and the constants `FIREWALL_IPC`, `FIREWALL_REQUEST_RECORD_CHANNEL`.

## Rule matching

- **Host**: exact, or a single-level subdomain wildcard `*.example.com` (matches `api.example.com`, NOT `example.com`, NOT `a.b.example.com`).
- **Port**: exact, or the wildcard sentinel `0` (matches any port).
- **Scheme**: always exact (no scheme wildcard).

## Persistence

Whitelist + blacklist persist to `<app.getPath('userData')>/firewall/state.json` as two arrays of `FirewallOrigin`. The project-origin set and infra ports are **not** persisted — they're re-supplied on every boot.
