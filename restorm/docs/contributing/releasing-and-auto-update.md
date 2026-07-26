# Releasing Restorm + how auto-update works

This covers cutting a release, how the in-app silent auto-update behaves, and how
to exercise it locally without a real release feed.

## How auto-update works

Restorm uses **electron-updater** against the generic feed configured in
`package.json` → `build.publish` (`https://dl.restorm.app`). `UpdateService`
(`src/main/services/UpdateService.ts`) drives the state machine:

- Checks on launch, every 4 h, and on the manual "Check now" button.
- Downloads in the background (`autoDownload`) and installs on the next quit
  (`autoInstallOnAppQuit`); the "Update ready" toast offers "Restart now".
- After an update, the first launch shows a "What's new" note built from the
  bundled `CHANGELOG.md` (entries since the previously-run version).

**Self-update only applies to direct-download builds** (the `.AppImage` on Linux,
NSIS `.exe` on Windows, `.dmg`/`.zip` on macOS). Store / package-manager channels
manage updates themselves and must ship with the updater inert — a build knows it
is store-distributed and skips electron-updater. In a non-packaged dev build the
updater is inert unless the dev mock is enabled (below).

**macOS** additionally requires the build to be signed + notarized before an
update can install (Gatekeeper rejects an unsigned/unnotarized `.app`); until the
signing pipeline is in place, macOS auto-update stays disabled while Linux and
Windows work.

## Cutting a release

1. **Update `CHANGELOG.md`** at the repo root: add a `## vX.Y.Z` section (newest
   on top) describing user-visible changes. The "What's new" note renders exactly
   this section, so write it for users. The heading MUST match `## vX.Y.Z`.
2. Bump the version (the release tooling / `manual-release.yml` creates the
   version bump + tag).
3. The release CI (`release.yml`) builds on each platform, signs where configured,
   and uploads the artifacts + `latest-*.yml` + `.blockmap` to the generic feed.
   `AppImage` is a required Linux target (the only auto-updatable Linux format).
4. Confirm the feed has the new `latest-linux.yml` / `latest.yml` /
   `latest-mac.yml` and the matching installers.

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

Against a real packaged `.AppImage` and a feed serving a newer version:

1. Launch the older version; confirm the background check downloads the newer one.
2. Confirm the "Update ready" toast appears and "Restart now" installs it.
3. After relaunch, confirm the "What's new in vX.Y.Z" note shows the CHANGELOG
   entries added since the previous version.
4. In Settings → Updates, confirm the auto-check toggle persists and the manual
   "Check now" reflects the live status.
