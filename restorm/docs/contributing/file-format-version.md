# The `.restorm` file format version

Every persisted Restorm document carries a `fileFormatVersion` on each root
`EnvironmentFolder`. It exists so a build can tell whether it understands
the file it is about to open, and so a future breaking change to the
on-disk model has a known starting point to migrate from.

The current value lives in `src/shared/config/fileFormatVersion.ts` as
`CURRENT_FILE_FORMAT_VERSION`.

## It is not the application version

`fileFormatVersion` describes the **on-disk model**, nothing else. It is
independent of the app's semver: releasing 1.4.0, or 2.0.0, does not move
it. Most releases never touch it. It is a small integer that has moved once
if at all, and a release note saying "now at file format 2" is a much
bigger deal than a release note saying "now at 2.0.0".

## When to bump it

Bump it when a **previous build can no longer read the file correctly**:

- a field whose meaning changes,
- a structure that moves or is nested differently,
- a value whose absence stops being equivalent to its default,
- anything an older build would silently misinterpret rather than ignore.

Do **not** bump it for purely additive changes. A new optional field that
an older build ignores harmlessly costs nothing; bumping for it locks every
existing user out of files created by newer builds until they update,
which is a real cost paid for no benefit.

That trade-off is the whole decision: a bump is a compatibility break you
are choosing to impose, so make it when the alternative is silent data
corruption, and not otherwise.

## What happens on load

Three cases, all decided before the document reaches the app:

| File declares | Behaviour |
| --- | --- |
| nothing (legacy file) | Defaults to the current version in memory. The document is **not** marked dirty — a default applied at load must not look like a user edit. |
| a version ≤ current | Opens normally. |
| a version > current | **Refused.** The document is not loaded, the previously open project stays open, and the user gets a localized message telling them to update Restorm. |

The refusal is deliberate, and the alternative was worse. Loading a
future-format file "as if it were current" produces a partial read, and the
next save writes the running build's impoverished understanding back over
the file — destroying the parts it did not understand. That failure is
invisible at the moment it happens and irreversible by the time anyone
notices, which is why the gate refuses rather than trying its best.

## Where the check lives

- `checkFileFormatCompatibility(content)` —
  `src/shared/config/fileFormatVersion.ts`. Pure, never mutates, and
  returns `{ supported, found, current }`. This is the gate.
- `normalizeFileFormatVersion(root, logger)` — same module. Repairs a
  document in place (defaults a missing or malformed value). It cannot
  refuse anything, which is exactly why the gate is a separate function.

Both entry points consult the gate before anything is written or loaded:

- **File mode** — installed as `validateOnOpen` on the `FileService` config
  in `src/main/index.ts`. The library calls it after parsing and before
  stamping the project UUID, so a refused file is never written to.
- **Folder mode** — called directly in `loadFolderStructure`
  (`src/main/FileOperations.ts`), before `ensureFolderUuid` writes to the
  index. Folder mode is the realistic way a user meets a future-format
  project at all: a colleague on a newer build commits, and git brings it
  in.

Both broadcast `file:open-rejected`; the renderer owns the message, because
the main process ships only two locales and the renderer ships all of them.

## Adding a new way to open a project

Any new entry point that parses a `.restorm` must call
`checkFileFormatCompatibility` before it loads or writes anything. If it
does not, `normalizeFileFormatVersion` logs a warning saying the gate was
bypassed — that warning is the signal that a path was added without one.
