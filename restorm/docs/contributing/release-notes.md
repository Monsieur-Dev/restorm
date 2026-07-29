# Writing release notes (the in-app "What's new")

> **Status:** authoritative process for the localized "What's new" notes.

The post-update **"What's new"** note is **release-communication copy** — a short,
user-facing summary of what changed, written by hand for each release. It is
**not** generated from tickets or commit messages: most commits are noise to a
user, and the wording is a product/marketing decision. Write it deliberately.

The English source is [`../../CHANGELOG.md`](../../CHANGELOG.md); each supported
UI language has a hand-written copy in `changelogs/<locale>.md`. After an update,
the app renders the sections added since the version the user last ran, in their
UI language (falling back to English).

## Per-release process

### 1. Recall what's going into this version

Look at the last two tags to remind yourself what shipped and what's new:

```bash
git fetch --tags
LAST=$(git describe --tags --abbrev=0)              # e.g. v0.1.16
PREV=$(git describe --tags --abbrev=0 "${LAST}^")   # the one before it

# What the LAST release contained (memory aid):
git log --oneline "${PREV}..${LAST}"
# What's NEW since the last release (candidates for this version's notes):
git log --oneline "${LAST}..HEAD"
```

### 2. Choose what to surface

From the "new since last release" list, pick the handful of **user-visible**
highlights — new features, notable fixes a user would feel, behaviour changes.
Skip refactors, CI, internal packaging, and anything invisible to a user. Phrase
each as a short benefit-oriented bullet (present tense, "you"-focused).

### 3. Write the English section

Add a `## vX.Y.Z` section at the top of `CHANGELOG.md` (newest first) with the
chosen bullets. Use the exact version you're about to release.

### 4. Translate to every locale

Add the same section, translated, to `changelogs/<locale>.md` for **all**
supported locales:

```
cs da de el es fi fr hr hu id it ja ko nb nl pl pt ro sq sr sv tr uk vi zh-CN zh-TW
```

Keep the `## vX.Y.Z` heading identical across files (the parser keys on it); only
the bullet text is translated. A missing locale falls back to English, so partial
translations are safe but not ideal.

### 4b. Images: inline **raster** `data:` URIs only

A note may include a screenshot. It **must** be embedded as an inline `data:`
URI, not linked to a remote URL:

```markdown
![The new response viewer](data:image/png;base64,iVBORw0KGgo…)
```

Restorm's outbound firewall denies background traffic, and an
`<img src="https://…">` in a release note is exactly that — it would be gated
(or prompt) while the user is just reading what changed. A `data:` URI carries
the bytes with the markdown, so nothing is fetched.

This is **enforced at render time**, not by rewriting your markdown: the release
notes are rendered by the `MarkdownViewer` in `inlineImagesOnly` mode, which
drops any image the renderer would have to fetch. So a remote image does not
render as a broken image — it silently does not appear at all. That covers
reference-style images (`![alt][ref]`) and `<picture><source srcset>` too, so
there is no way to sneak a remote image in.

Two constraints that follow from this, both of which fail *silently*:

- **Raster formats only** — `png`, `jpeg`, `gif`, `webp`, `avif`, `bmp`. An
  inline `data:image/svg+xml` is deliberately rejected: an SVG is a *document*,
  not just pixels, and the viewer renders untrusted markdown with raw HTML
  enabled. Export the diagram to PNG instead.
- **Keep them small** — a wide PNG inflates every locale file *and* the hosted
  changelog the app downloads on every open of the release-notes modal.

### 5. Ship + release

Commit the notes on your branch, then ship — optionally cutting the release in the
same step:

```bash
scripts/ship.sh --release patch   # rebase → push (e2e) → wait CI → merge → release
```

`--release` triggers the version bump/tag + the build-and-publish workflow right
after a successful merge (see
[`releasing-and-auto-update.md`](./releasing-and-auto-update.md)). It is only
honoured when the merge actually runs (i.e. not with `--no-merge`).

## Where it renders

Two surfaces, two data paths:

- **The post-update "What's new" toast** reads the **bundled** `changelogs/` +
  `CHANGELOG.md` via `UpdateService.getChangelogSince(fromVersion, locale)` —
  the notes for the version that just installed ship inside it.
- **The release-notes modal** (Help → "Release Notes", plus a link on the
  "Update ready" and "What's new" toasts) reads
  `UpdateService.getReleaseNotes(locale)`, which **fetches the hosted changelog
  from the release feed** — `https://dl.restorm.app/changelogs/<locale>.md`,
  English at `/CHANGELOG.md`. It has to: opened from the "Update ready" toast it
  shows notes for a version the *running* build does not bundle. The fetch runs
  inside `withFirewallBypass` (same exemption as the updater), times out quickly,
  and falls back to the bundled changelog when the feed is unreachable.

Both paths pass the current `i18n.language` and fall back to English. The feed
copy is refreshed by `release.yml` on every release, so it always holds the full
history. Verify with the dev mock in
[`releasing-and-auto-update.md`](./releasing-and-auto-update.md).
