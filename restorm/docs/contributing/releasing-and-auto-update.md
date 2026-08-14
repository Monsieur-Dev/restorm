# Releasing Restorm + how auto-update works

This covers cutting a release, how the in-app silent auto-update behaves, and how
to exercise it locally without a real release feed.

## How auto-update works

Restorm uses **electron-updater** against the generic feed configured in
`package.json` → `build.publish` (`https://dl.restorm.app`). `UpdateService`
(`src/main/services/UpdateService.ts`) drives the state machine:

- Checks on launch, every 4 h, and on the manual "Check now" button.
- Downloads in the background (`autoDownload`) but never installs on quit
  (`autoInstallOnAppQuit` is kept **off**): the "Update ready" toast's "Restart
  now" button is the only install path. Installing from the quit handler runs
  after the last window is gone, and on the platforms whose installer needs
  elevation it blocks the main thread behind a prompt with no window to belong
  to — which leaves the app running, invisible, with no way for the user to
  stop it.
- After an update, the first launch shows a "What's new" note built from the
  bundled `CHANGELOG.md` (entries since the previously-run version).

**Self-update only applies to direct-download builds** (the `.AppImage`, `.deb`
and `.rpm` on Linux, NSIS `.exe` on Windows, `.dmg`/`.zip` on macOS — every
artifact published to the generic feed self-updates, each through its own
electron-updater backend). Store / package-manager channels
manage updates themselves and must ship with the updater inert — a build knows it
is store-distributed and skips electron-updater. In a non-packaged dev build the
updater is inert unless the dev mock is enabled (below).

**macOS** additionally requires the build to be signed + notarized before an
update can install (Gatekeeper rejects an unsigned/unnotarized `.app`); until the
signing pipeline is in place, macOS auto-update stays disabled while Linux and
Windows work. When that lands, re-check the download UX: with install-on-quit
off, `MacUpdater` does not hand the payload to Squirrel during the background
download — it stages it when the user presses "Restart now", so that press can
sit for a while. Worth a progress indication before it ships.

**Firewall.** Restorm's outbound firewall denies background traffic by default.
The updater's requests to the feed are a background system operation, so
`UpdateService` wraps the updater's network calls (`checkForUpdates` +
`downloadUpdate`) in `withFirewallBypass` — the same AsyncLocalStorage-scoped
exemption the cloud backend fetch uses for its own external host. This exempts
every socket connect made within the scope, including the auto-download
electron-updater kicks off synchronously inside `checkForUpdates`. A static
host-allow in the firewall's `internalRequestPredicate` would NOT suffice: that
predicate only exempts the http layer, while the socket-layer `HardenInterceptor`
still classifies the raw connect to an external host — so the scoped bypass is
the correct mechanism.

**Differential downloads.** electron-updater fetches only the changed blockmap
regions on an update rather than the full installer, but by default it tries to
combine every changed region into a single multi-range `Range:` request
(`bytes=a-b, c-d, ...`) and expects a `multipart/byteranges` response. The feed's
storage backend (Cloudflare R2, behind `dl.restorm.app`) rejects that combined
form with `HTTP 400` while honouring a single-range request (`Range: bytes=a-b`)
fine — a known R2 limitation, not an electron-updater bug. `build.publish` sets
`useMultipleRangeRequest: false` so the updater instead issues one sequential
single-range request per changed block; the download is still differential
(only changed bytes are fetched), just via many small requests instead of one
combined one.

## Cutting a release

1. **Write the release notes** — add a `## vX.Y.Z` section (newest on top) to
   `CHANGELOG.md` (English) **and** each `changelogs/<locale>.md`. The heading MUST
   match `## vX.Y.Z`. These are hand-written, user-facing communication copy;
   follow [`release-notes.md`](./release-notes.md) for the tag-diff → pick →
   translate process.
2. Bump the version (the release tooling / `manual-release.yml` creates the
   version bump + tag). `scripts/ship.sh --release <patch|minor|major>` does this
   automatically right after the merge.
3. `manual-release.yml` then **calls `release.yml` itself**, in the same run —
   nothing to trigger by hand. (It has to: a tag pushed by CI carries the
   `GITHUB_TOKEN`, and GitHub never starts a workflow from a `GITHUB_TOKEN`
   event, so `release.yml`'s own `on: push: tags` trigger stays silent for it. A
   tag pushed by a human does trigger it directly.)
4. `release.yml` builds on each platform, signs where configured, and uploads the
   artifacts + `latest-*.yml` + `.blockmap` to the generic feed. `AppImage` is a
   required Linux target (the only auto-updatable Linux format). The feed is the
   **only** distribution channel — no GitHub Release is published, and nothing is
   downloadable from the repository. A final job
   mirrors the **release notes** next to them: `CHANGELOG.md`,
   `changelogs/<locale>.md` for every locale (English included, as
   `changelogs/en.md`), and this version's section alone as
   `release-notes/vX.Y.Z.md` — so any consumer reads the notes from the feed
   without needing access to this repository.
5. Confirm the feed has the new `latest-linux.yml` / `latest.yml` /
   `latest-mac.yml`, the matching installers, `manifest-<platform>.json`, and
   `release-notes/vX.Y.Z.md`.
6. **Re-open the dev cycle — MANDATORY, do not skip.** Immediately bump `main`'s
   `restorm/package.json` back to the next dev version WITH a `-preview` suffix
   (e.g. after cutting `0.1.20`, set `0.1.21-preview`). The release tooling
   strips `-preview` to cut the release, so `main` is left on a plain version;
   if it stays that way, every unpackaged dev build off `main` resolves to the
   **PROD** backend instead of DEV (see `src/shared/config/backend.ts` —
   `resolveChannel` keys the channel off the `-preview` suffix). A developer or
   agent testing "on dev" would then silently hit the production Supabase /
   WorkOS. Treat this bump as part of the release, not an afterthought.

## The npm launcher's release manifest

`restorm-cli` (the `npm-cli/` package) is not the application: it resolves one,
in the order *system install → per-user cache → download*. That last step reads
a manifest the release publishes, written by
[`scripts/release-manifest.mjs`](../../scripts/release-manifest.mjs) and
uploaded as `manifest-linux.json`, `manifest-darwin.json`, `manifest-win32.json`
— under both `latest/` and `v<version>/`.

Three properties of that file are load-bearing; changing any of them without
changing the launcher breaks `npm i -g restorm-cli` for everyone:

- **One file per platform.** The R2 upload runs inside `release.yml`'s build
  matrix, so no job ever holds all three platforms' artifacts. A merged
  manifest would need a fourth job that agrees with the other three.
- **Artifact URLs point into `v<version>/`, never `latest/`.** The launcher
  verifies the download against the `sha256` in the manifest; a mutable URL
  would let the file and its checksum disagree during the minutes a release is
  uploading.
- **The npm package's version is the app version it fetches.** `npm-publish.yml`
  stamps `restorm-cli` with the released version, and the launcher asks for
  `v<its own version>/` first, falling back to `latest/` only on a 404. That is
  what makes `restorm-cli@1.0.2` still run Restorm 1.0.2 a year later —
  `RESTORM_VERSION` overrides it, `RESTORM_VERSION=latest` opts back in.

Every platform therefore needs a target that runs **without an installer**:
AppImage on Linux, the `zip` target on macOS and Windows (the Windows one exists
for this reason alone — `nsis` cannot be unpacked and run). The launcher's own
tests (`cd npm-cli && npm test`) cover the resolution, checksum and cache rules;
they run in the pre-commit hook and in CI.

## Exercising auto-update locally (dev mock)

Set `RESTORM_UPDATE_MOCK` to drive `UpdateService` through a scripted engine
(`src/main/services/mockUpdaterEngine.ts`) — no real feed needed:

- `RESTORM_UPDATE_MOCK=uptodate` — a check reports no update (manual check →
  "You're up to date" toast).
- `RESTORM_UPDATE_MOCK=available` — a check finds and downloads an update.
- `RESTORM_UPDATE_MOCK=downloaded` — a check finds + fully downloads → the
  "Update ready → Restart now" toast (the mock's restart is a no-op).

Example: `RESTORM_UPDATE_MOCK=downloaded pnpm dev:restorm`. The e2e suite
(`tests/e2e/bdd/auto-update`) launches with `RESTORM_UPDATE_MOCK=uptodate`.

## Manual QA checklist (packaged build)

Against a real packaged build and a feed serving a newer version — run it at
least once on a `.deb`/`.rpm` as well as the `.AppImage`, since those install
through a different backend that needs a privilege prompt:

1. Launch the older version; confirm the background check downloads the newer one.
2. Confirm the "Update ready" toast appears and "Restart now" installs it AND
   brings the app back up on the new version.
3. Quit and relaunch WITHOUT pressing the button; confirm the old version is
   still running (nothing installs on quit) and that no windowless process is
   left behind.
4. After relaunch, confirm the "What's new in vX.Y.Z" note shows the CHANGELOG
   entries added since the previous version.
5. In Settings → Updates, confirm the auto-check toggle persists and the manual
   "Check now" reflects the live status.
5. Watch the update log for `Cannot download differentially, fallback to full
   download` — it should NOT appear, and the downloaded byte count should be a
   small fraction of the full installer size, confirming the differential path
   actually succeeded against the production feed rather than silently falling
   back.
