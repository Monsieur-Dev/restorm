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

The bundled `changelogs/` + `CHANGELOG.md` are read at runtime by
`UpdateService.getChangelogSince(fromVersion, locale)`; the renderer passes the
current `i18n.language`. Verify with the dev mock in
[`releasing-and-auto-update.md`](./releasing-and-auto-update.md).
