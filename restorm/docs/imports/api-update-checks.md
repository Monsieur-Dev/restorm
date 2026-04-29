# API spec update checks — runbook

Restorm can periodically re-fetch the source spec for any environment
folder that was created from one (Swagger, OpenAPI 3, GraphQL,
Postman, Insomnia, Bruno, AsyncAPI, gRPC, SOAP, OData) and surface
changes as a non-destructive refresh. This page covers the
operator-facing UX; the developer surface lives in
[`adapter-interface.md`](./adapter-interface.md).

## Configuring auto-checks

Open the env folder home page and scroll to **API spec updates**.

- **Check for updates automatically** — toggle. When off, the
  scheduler skips this folder. The user can still trigger a manual
  check.
- **Interval** — `Hourly` / `Every 6 hours` / `Daily` (default) /
  `Weekly` / `Never`. The scheduler tick is fixed at 5 minutes; the
  per-folder cadence is enforced inside the tick.
- **URL** — the spec source. Supports `${VAR}` substitution from the
  env folder's environment variables. Edit and tab-out to persist.
- **Headers** — optional auth headers, also `${VAR}`-expanded at
  fetch time. Use this for `Authorization: Bearer ${TOKEN}` against
  protected specs without storing the token in plain text on disk.

The status pill shows the current state:

- **Up to date** — the latest fetch matched the stored content hash
  + version.
- **Checking** — a fetch is in progress.
- **Update available** — a new version is on the source. The folder
  also gains a small dot in the sidebar tree, and a toast fires the
  first time we detect each version.
- **Last check failed** — the most recent fetch errored. Auto-check
  failures stay in this pill (no toast); manual failures also push a
  toast.

## Applying an update

Two entry points:

1. The **Apply update** button next to the status pill.
2. **Refresh from source** in the right-click menu of an env folder
   that has a source URL configured. This opens a confirmation
   dialog with counters before any change is applied.

Apply runs the idempotent pipeline:

- New operations are appended to the tree at the same place a fresh
  import would land them.
- Operations the spec marked `deprecated` are flagged on the
  matching local request — italic + muted in the sidebar.
- Operations that vanished from the spec are marked `removed` —
  strikethrough in the sidebar but **still executable**, so the user
  can call legacy endpoints against an out-of-date server.
- HTTP params / headers / pathParams added in the spec are appended
  to the existing request with empty values. The user's stored
  values are preserved.
- Models + enum definitions on the env folder are replaced wholesale
  from the freshly imported folder, so a widened enum reaches every
  KV editor on the next render.

## Migration of legacy folders

Folders saved before the `apiUpdate` field existed get a backfill on
project load:

- `apiUpdate.sourceUrl` is copied from `apiDocumentation.sourceUrl`
  when available.
- `autoCheckEnabled` defaults to `false` — opt-in. The user enables
  it from the settings section.
- For Swagger / OpenAPI folders, `importOrigin` on legacy HTTP
  requests is synthesised from `${METHOD} ${url}` so the very first
  refresh can match existing requests instead of treating them as
  user-created and re-importing every operation as new.

## Persisted state

Stored on the env folder model under `apiUpdate`:

- `sourceUrl` — single source of truth for the fetch target.
- `sourceHeaders` — optional `Record<string, string>`, `${VAR}`-expanded.
- `autoCheckEnabled` — boolean.
- `interval` — `'hourly' | 'every6h' | 'daily' | 'weekly' | 'never'`.
- `lastCheckedAt` — epoch ms of the most recent attempt.
- `lastImportedSpecVersion` — `info.version` of the last applied spec.
- `lastImportedSpecHash` — sha256 over the canonical normalised spec.
  Detects changes the spec author shipped without bumping the version.

The runtime `ApiUpdateState` is **not** persisted — the next launch
re-derives `idle` / `available` from the latest fetch.
