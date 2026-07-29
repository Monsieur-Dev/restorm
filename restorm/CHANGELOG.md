# Changelog

Notable changes per released version. Each release is a `## vX.Y.Z` section; the
in-app "What's new" notification renders the entries added since the version you
last ran. Newest version on top.

Localized "What's new": these English notes are the source; hand-written
per-language copies live in `changelogs/<locale>.md`. This is deliberate
release-communication copy, written per release — not generated from tickets. See
[docs/contributing/release-notes.md](docs/contributing/release-notes.md) for the
per-release process.

## v0.1.19

- Linux: the AppImage now starts reliably and applies updates without getting
  stuck, including on distributions with a hardened sandbox.
- macOS: Intel builds are now available alongside Apple Silicon.

## v0.1.17

- Release notes are now shown in your language.
- Linux, Windows and macOS desktop apps: the installer now shows Restorm's icon,
  name and details, and the app opens with your theme applied.

## v0.1.12

- Silent background auto-update: Restorm now checks for updates on launch and
  every few hours, downloads them in the background, and installs on the next
  restart. A "What's new" note is shown after each update.
- Manual "Check for updates" control and an auto-update toggle in Settings.
