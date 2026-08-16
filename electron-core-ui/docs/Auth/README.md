# Auth & Entitlement

Generic cloud-auth + capability machinery for ECUI-based Electron apps.

## What is this?

A self-contained authentication and entitlement stack that any ECUI host app can
adopt without writing auth boilerplate. It covers:

- **Loopback OAuth login** (RFC 8252) — opens the system browser, listens on a
  random localhost port, exchanges the authorization code for a session JWT.
- **Session management** — HS256 session JWT stored securely with electron
  `safeStorage`; expiry checked before every guarded fetch.
- **Entitlement JWT** — EdDSA-signed token fetched from a cloud function and
  verified offline; carries `plan` + `capabilities`.
- **Auto-refresh** — interval + window-focus-triggered refresh; throttled by
  `minGapMs` to avoid hammering the backend.
- **IPC bridge** — `auth:login`, `auth:logout`, `auth:get-state`,
  `auth:state-changed`, `auth:checkout` channels registered on the main process
  and exposed via `window.api.account` in the renderer preload.
- **Avatar firewall exemption** — keeps the firewall's system allowlist in
  lock-step with the signed-in user's avatar CDN host.

## Generalisation contract

All host-specific strings are **injected**:

| injected dep | where | restorm default |
|---|---|---|
| `sessionAudience: string` | `EntitlementServiceDeps` | `'restorm-session'` |
| `entitlementAudience: string` | `EntitlementServiceDeps` | `'restorm-entitlement'` |
| `isEligibleUrl: (url: string) => boolean` | `GuardedFetchDeps` | `isBackendFunctionsUrl(url, host)` |
| `successHtml?: string` | `LoopbackLoginDeps` | generic success page |
| `errorHtml?: string` | `LoopbackLoginDeps` | generic error page |

`Capability` is not defined in ECUI — `capabilities` is `string[]` everywhere.
The host app narrows to its own union for static checking.

## Quick start

```ts
// main process composition root
import {
  AuthStore, EntitlementService, registerAuthIpc,
  withFirewallBypass, AvatarFirewallExemption, permissionService
} from 'electron-core-ui/main'
import { app, safeStorage } from 'electron'
import path from 'node:path'

const authStore = new AuthStore(
  path.join(app.getPath('userData'), 'auth.json'),
  safeStorage,
  { read: ..., write: ..., remove: ... }
)

const entitlementService = new EntitlementService({
  authStore,
  sessionAudience: 'my-app-session',
  entitlementAudience: 'my-app-entitlement',
  entitlementUrl: 'https://api.example.com/functions/v1/entitlement',
  checkoutUrl: 'https://api.example.com/functions/v1/checkout',
  loginUrl: 'https://auth.example.com/login',
  publicKeySpkiPem: MY_EDDSA_PUBLIC_KEY_PEM,
  guardedFetch: makeGuardedFetch({
    isEligibleUrl: (url) => url.startsWith('https://api.example.com/functions/'),
    bypass: withFirewallBypass,
  }),
  successHtml: '<h1>Signed in!</h1>',
  errorHtml: '<h1>Sign-in failed.</h1>',
})

registerAuthIpc(ipcMain, entitlementService)
```

## Renderer

```tsx
// renderer — the AccountButton wires itself up automatically
import { AccountButton } from 'electron-core-ui/renderer'
// or read auth state in any component:
import { useAuthState } from 'electron-core-ui/renderer'
const { signedIn, user, plan, role, capabilities } = useAuthState()
// `role` is the user's org role: 'admin' (master account — manages billing,
// seats, members) or 'member' (a seat-holder). Defaults to 'member' (least
// privilege) when signed out or when the session carried no role. Use it to
// hide account-management surface from members; the backend still enforces the
// real gate on the LIVE role, so a stale role here only affects what's shown.
```

## Multi-instance: live propagation of the shared cache

Several instances of the host app may share one `userData` — and therefore one
auth cache. `startAuthStoreWatch` + `EntitlementService.reloadFromStore()`
turn a login/logout/plan-change persisted by one instance into a live update
in all the others, without a restart:

```ts
import { startAuthStoreWatch } from 'electron-core-ui/main'

const watch = startAuthStoreWatch({
  filePath: join(userData, 'auth-session.dat'),
  onChange: () => { void entitlementService.reloadFromStore() },
  onError: (err) => log('watch unavailable — propagation degrades to restart', err)
})
// on quit:
watch.stop()
```

Contract points, all deliberate:

- the watcher observes the **parent directory** (an atomic temp+rename write
  replaces the file's inode; a file-level watch would go silent after the first
  replacement) and debounces the event burst of one write into one callback;
- `reloadFromStore()` is **read-only** (never `clear()`s — the writer owns the
  file) and **network-free** (the writer already fetched; readers only verify);
- **nothing is trusted from the file but tokens**: capabilities are re-derived
  from the signed entitlement JWT, offline-verified by each instance — a
  doctored cache yields community, not the doctored state;
- a reload caused by the instance's own `persist()` re-reads an identical
  state and is deduplicated by the broadcast's `statesEqual`.

The host's `AuthStoreFs.write` MUST be atomic (temp file + rename) once a
watcher exists — a plain `writeFileSync` lets a concurrent reader see a torn
envelope.

## Test helpers

```ts
import { generateEdKeyPair, signEntitlement, ENTITLEMENT_AUD, SESSION_AUD } from 'electron-core-ui/main'

const keys = await generateEdKeyPair()
const token = await signEntitlement({ privateKey: keys.privateKey, plan: 'pro', capabilities: ['my.feature'] })
```

`ENTITLEMENT_AUD` / `SESSION_AUD` are the restorm defaults; override for other
audience strings.

## File map

```
src/shared/auth/authState.ts          — AuthState, AUTH_IPC, SIGNED_OUT_STATE
src/main/services/auth/
  authStore.ts                        — encrypted token persistence
  authStoreWatch.ts                   — shared-cache watch (multi-instance)
  sessionToken.ts                     — HS256 JWT utilities
  guardedFetch.ts                     — network guard (isEligibleUrl)
  loopbackLogin.ts                    — RFC 8252 flow
  avatarFirewallExemption.ts          — CDN host allow-list
  authIpc.ts                          — IPC channel registration
src/main/services/entitlement/
  entitlementClient.ts                — EdDSA JWT fetch + verify
  autoRefresh.ts                      — interval + focus refresh
  EntitlementService.ts               — reactive capability source of truth
  entitlementTestKit.ts               — test signing helpers
src/renderer/hooks/useAuthState.ts    — React hook: live AuthState
src/renderer/components/AccountButton — avatar + sign-in/sign-out dropdown
```
