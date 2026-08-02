# Firewall

Restorm runs a non-trivial graph of npm dependencies, any of which could open an outbound HTTP / WebSocket / TCP connection without your knowledge. The internal firewall blocks every outgoing call by default and only lets it through when the destination is *known*.

This doc covers:

1. [Two layers of interception](#two-layers-of-interception)
2. [Verdict resolution](#verdict-resolution)
3. [The whitelist + blacklist](#the-whitelist--blacklist)
4. [The toast prompt](#the-toast-prompt)
5. [The `View → Firewall` panel](#the-view--firewall-panel)
6. [Worker / child-process posture](#worker--child-process-posture)
7. [Runbook — "the firewall blocked something I need"](#runbook--the-firewall-blocked-something-i-need)

The firewall engine + UI are a **generic, reusable feature of `electron-core-ui`** — restorm keeps only its configuration (infra ports, project origins, the internal GraphQL-bridge endpoint to skip, copy/wording). The library's source lives in [`electron-core-ui/src/main/services/firewall/`](../../electron-core-ui/src/main/services/firewall/) + [`electron-core-ui/src/renderer/components/Firewall/`](../../electron-core-ui/src/renderer/components/Firewall/); its public surface is documented in [`electron-core-ui/docs/Firewall/README.md`](../../electron-core-ui/docs/Firewall/README.md). This page describes how restorm **wires + uses** it.

---

## Two layers of interception

The firewall has two cooperating interception points wired to the same `PermissionService`:

### Layer A — Chromium webRequest (renderer-side)

`session.defaultSession.webRequest.onBeforeRequest` is registered at app boot. Every call coming from the renderer (`fetch`, `XMLHttpRequest`, subresource loads, `WebSocket` upgrades) is captured. Chromium holds the request until the verdict resolves, so a blocked call really doesn't reach the network — there's no "we logged it then served it" race.

### Layer B — main-process patches

At the very top of `main/index.ts`, before any other import, the firewall monkey-patches:

- `http.request` / `http.get`
- `https.request` / `https.get`
- `globalThis.fetch` (Node 18+ undici path)

Every later require / dynamic import inherits the patches. A `RequestRecord` is built for each call and routed through the same `PermissionService`. Calls denied at this layer fail with `EFIREWALLDENIED`; calls in the `prompt` state are parked in a [`BufferingClientRequest`](../../electron-core-ui/src/main/services/firewall/BufferingClientRequest.ts) that buffers writes / headers / timeouts until the user picks Allow or Deny.

`net.Socket.connect` / `dns.lookup` / `dgram.send` are scaffolded in [`HardenInterceptor.ts`](../../electron-core-ui/src/main/services/firewall/HardenInterceptor.ts) but **not wired** at boot — undici's path through `net.Socket.prototype.connect` interacts poorly with the wrap. The http/https/fetch coverage handles ~95% of what restorm and its dependencies actually do; the harden interceptor is staged for a follow-up that decodes every undici signature variant.

---

## Verdict resolution

Every captured call goes through `PermissionService.classify(input)` first — synchronous, no IPC. The gates fire in this order:

1. **Empty host** → `allow`. (Defensive — `data:`, `blob:`, etc. shouldn't reach this point but if they do they pass.)
2. **Restorm infrastructure ports on localhost** → `allow`. The narrow exemption: GraphQL bridge port + Vite dev port + MCP server port. Any other localhost port goes through the same gates as external hosts.
3. **Whitelist hit** → `allow`. Persisted user decision.
4. **Project-derived origin hit** → `allow`. Auto-seeded from the open project's request URLs (after `{{var}}` substitution).
5. **Blacklist hit** → `deny` immediately, no prompt.
6. **Otherwise** → `prompt`. The async `check()` opens a toast and waits for the user.

Layer A awaits the async verdict directly. Layer B uses the synchronous classification + a `BufferingClientRequest` so the call's return is never blocked.

---

## The whitelist + blacklist

Both are `FirewallOrigin` triples — `{ scheme, host, port }`:

- The **whitelist** is the user's explicit allow list. Adding here means "let this through silently from now on". Persisted to `<userData>/firewall/state.json`.
- The **blacklist** is the user's explicit deny list. Adding here means "fail this immediately, don't ask again". Same persistence file.
- Adding an origin to one list **clears** the matching entry on the other — the user is reversing a prior decision.

Different ports for the same host are **distinct** decisions: `(https, api.example.com, 443)` and `(https, api.example.com, 8443)` can have different verdicts. Same for schemes — `http` and `https` are different.

The **project-derived set** is computed by the renderer's `useFirewallProjectOriginsSync` hook. It walks every request URL in `rootItems`, substitutes `{{vars}}` against every available environment, normalises the result to an origin triple, dedupes, and pushes the union to main via `firewall:set-project-origins`. This refires on every project tree change. **Importing a Petstore swagger doesn't trigger a flood of prompts** — the host appears in the project-origins set the moment the import lands.

---

## The toast prompt

When `classify()` returns `prompt` and a renderer window is available, a toast pops with:

- The destination origin (`https://example.com:443`).
- The capturing layer (`main-https`, `renderer-webrequest`, etc.).
- A **best-effort caller hint** — for Layer A the Chromium initiator URL; for Layer B a stack-trace walk that names the originating npm package or first-party file. See [`stackOrigin.ts`](../../electron-core-ui/src/main/services/firewall/stackOrigin.ts).
- Two buttons:
  - **Allow** → adds the origin to the whitelist + lets the request through.
  - **Deny** → adds the origin to the blacklist + fails the request with `EFIREWALLDENIED`.

If no renderer window can show the toast (early boot, headless), the prompt **auto-denies** and the origin is added to the blacklist — conservative default.

If the user doesn't answer within 60 seconds, the prompt times out and auto-denies. The origin is added to the blacklist. Reopen the panel to remove it later.

In **E2E mode** (`RESTORM_USER_DATA_OVERRIDE` env var set by Playwright fixtures), the prompt path is short-circuited to `allow` — mock-server ports are dynamic and nobody can click a toast in headless mode.

---

## The `View → Firewall` panel

Singleton workbench tab. Built end-to-end with `electron-core-ui` primitives:

- A 72-pixel shield codicon + H1 + intro paragraph.
- A `<Tabs>` strip with `Whitelist (X)` / `Blacklist (Y)` showing live counts.
- Each row is a full-width `<ControlGroup>` with a read-only origin label + an icon-only trash button.
- The "add" row at the top of each tab takes free-form `scheme://host:port` text.

The panel holds the surface you act on and nothing else: the destinations
Restorm contacts on its own initiative are declared and auditable (see below),
but they are not listed here — a read-only inventory of the app's own plumbing
sat between you and the lists you actually edit.

The panel mirrors the `View → Console` pattern: one tab, no specific group placement, persists across project reloads.

---

## Outbound services — what Restorm itself contacts

The whitelist / blacklist govern *your* API traffic. Restorm also makes a handful
of calls of its own, and those bypass the user firewall by design — otherwise
signing in would prompt you to whitelist your own licence server. Left
undeclared they would be the one class of outbound call nothing could account
for, which is exactly what a firewall is supposed to rule out. So every one of
them is declared in
[`src/shared/config/observability.ts`](../../src/shared/config/observability.ts)
(or at its own composition root) — **including the ones that are currently
switched off**.

| Endpoint | Host | Consent gate | How it gets through |
|-----|------|--------------|---------------------|
| `backend` | the channel's Supabase Edge Functions host | none — the app cannot manage your licence without it | call-scoped bypass around the guarded fetch |
| `avatar` | the signed-in account's photo CDN (`lh3.googleusercontent.com`, …) | none — display asset, and only while signed in | system allowlist, registered on login and dropped on logout |
| `crash` | the crash-report ingest | `privacy:crashReports` | system allowlist, registered only while consent is active |
| `telemetry` | the product-analytics ingest | `privacy:telemetry` | system allowlist, registered only while consent is active |

Each declaration carries the exact host, why it is contacted, and its live
state. That state is **computed from the firewall**, not from a flag the sender
sets: an endpoint reads active only while the host is genuinely exempt. That is
what makes revocation enforceable — turn `privacy:telemetry` off in
**Preferences → Privacy** and the host leaves the allowlist, so a queued event
retried afterwards hits the same prompt-or-block path as any unknown tracker
would. The inventory is readable over
`window.api.firewall.listSystemEndpoints()`, which is what the tests assert
against.

Hosts are always matched **exactly** and over **https** only. There is no
wildcard form here — a `*.ingest.example.com` exemption would cover every other
tenant of a shared provider.

The section is read-only on purpose. These entries are declared in code and
governed by the Privacy settings; letting the panel delete one would create a
state where the app believes it may phone home and the firewall disagrees.

### Consent

Two toggles under **Preferences → Privacy**, both resolved by the
main-process `ConsentService` (`src/main/services/privacy/consentComposition.ts`):

- **`privacy:crashReports`** — plan-modulated. Mandatory for Community (free)
  accounts, where the control renders visible-but-locked with an upsell; every
  paid plan can turn it off. `canSend('crash')` applies the same rule, so the
  locked control can never disagree with what is actually sent.
- **`privacy:telemetry`** — opt-in, default off, for everyone.

Each decision is stamped with a timestamp and the privacy-policy version in force
at the time, in `<userData>/privacy/consent.json`. See the generic model in
[`electron-core-ui/docs/Architecture/Privacy.md`](../../../electron-core-ui/docs/Architecture/Privacy.md).

---

## Worker / child-process posture

`worker_threads.Worker` and `child_process.fork` spawn fresh V8 contexts that don't inherit the main-process patches. The firewall closes that gap by patching both constructors to inject `--require <bootstrap>` into the spawned child's `execArgv`. The bootstrap script (written to `os.tmpdir()` at install time) takes a hard, conservative posture:

> Inside a worker / forked child, **all** outbound HTTP / HTTPS / fetch traffic is denied. No IPC channel back to the parent, no whitelist override.

Restorm itself does not currently spawn workers or fork children. This is defensive: if a future npm dependency starts doing it, the firewall posture stays intact. If a legitimate restorm worker ever needs network access, the cleanest path is an IPC bridge back through the parent's `PermissionService` — out of scope for the current ticket.

---

## Runbook — "the firewall blocked something I need"

### Symptom: a request that used to work returns `EFIREWALLDENIED`

1. Open `View → Firewall`. Click the **Blacklist** tab. Find the entry that matches the destination.
2. Click the trash icon on the row. The blacklist entry is gone — next call to that origin will re-prompt.
3. Trigger the request again. When the toast appears, click **Allow**. The origin moves to the whitelist; subsequent calls pass silently.

If the entry isn't visible in the blacklist:

- It might have been blacklisted under a different scheme / port. `https://api.example.com` and `http://api.example.com` are distinct entries; same for `:443` vs `:8443`.

### Symptom: the toast never appears

1. Check that a restorm window is focused — toasts fire on the active renderer.
2. Check `/tmp/restorm-mcp/<pid>.json` doesn't exist for a stale instance — sometimes a foreground window is masked by an MCP-launched headless instance.
3. Inspect main-process logs for `PermissionService: prompt timed out (auto-deny)` — if the prompt fired but you didn't answer in 60 seconds, the request was denied automatically.
4. If running E2E or with `RESTORM_USER_DATA_OVERRIDE` set, the prompt is bypassed — that's intentional for tests.

### Symptom: I want to allow ALL traffic to a host regardless of port

Add a **port wildcard** entry: `https://api.example.com:*` matches any port on that host. A **single-level subdomain wildcard** is also supported: `https://*.example.com` matches `api.example.com` (but not the bare `example.com`, and not `a.b.example.com`). The scheme is always matched exactly.

### Symptom: I want to inspect what was blocked recently

Open `View → Console`. Every captured request is rendered there with its verdict. Filter the buffer by typing into the toolbar's search box (`Ctrl+F` inside xterm). Denied calls show with the `verdict: 'deny'` label and `errorMessage` filled in.

### Symptom: I want to disable the firewall entirely

There's no kill switch — by design. The closest equivalent is to whitelist `0.0.0.0:0` and… that won't work, because every origin is normalised. If you genuinely need a disabled firewall (debugging an interception bug), comment out `installMainProcessInterceptor()` and `firewallService.registerWebRequestListener()` in `main/index.ts` for a local build. Don't do this in shipped code.

---

## Tests

Unit tests live alongside the sources in `electron-core-ui`:

- [`PermissionService.test.ts`](../../electron-core-ui/src/main/services/firewall/PermissionService.test.ts)
- [`BufferingClientRequest.test.ts`](../../electron-core-ui/src/main/services/firewall/BufferingClientRequest.test.ts)
- [`MainProcessInterceptor.test.ts`](../../electron-core-ui/src/main/services/firewall/MainProcessInterceptor.test.ts) (idempotency)
- [`stackOrigin.test.ts`](../../electron-core-ui/src/main/services/firewall/stackOrigin.test.ts)
- [`protocolDetect.test.ts`](../../electron-core-ui/src/main/services/firewall/protocolDetect.test.ts)

Run them from the `electron-core-ui` package with `npx vitest run src/main/services/firewall`.

The consent + outbound-visibility half is covered by
[`ConsentService.test.ts`](../../electron-core-ui/src/main/services/privacy/ConsentService.test.ts),
[`ConsentFirewallExemption.test.ts`](../../electron-core-ui/src/main/services/privacy/ConsentFirewallExemption.test.ts),
[`scrub.test.ts`](../../electron-core-ui/src/shared/privacy/scrub.test.ts) and
[`observability.test.ts`](../../src/shared/config/observability.test.ts), plus the
`firewall-exemptions` E2E project which drives the real app across a consent
grant and revocation and asserts the host enters and leaves the firewall's
system allowlist.
