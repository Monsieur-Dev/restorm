# The `.restorm` file format version

Every persisted Restorm document carries a `fileFormatVersion` **at its
root**. It exists so a build can tell whether it understands the file it is
about to open, and so a future breaking change to the on-disk model has a
known starting point to migrate from.

```yaml
fileFormatVersion: 1
collections:
  - folderType: environment
    name: Petstore
    …
```

The current value lives in `src/shared/config/fileFormatVersion.ts` as
`CURRENT_FILE_FORMAT_VERSION`.

## Why the root, and nowhere else

The version describes the FILE. Anywhere else, the same file can hold more
than one answer: put it on each collection and a nine-collection project
has nine possible carriers with nothing keeping them in agreement — which
is where the field started, and in practice exactly one of the nine was
ever filled.

Folder mode has the same rule applied to its layout: the version goes in
the project's root `index.<ext>`, beside `_projectUuid`, never in a
collection's own index.

This placement is the one thing about this field that could not have been
fixed later: moving it after release would need a format migration, which
is the mechanism this field exists to provide.

## One read site, and no fallback

The root is the **only** place the version is read from. There is no
fallback to the old position, and adding one back would be a regression:
a second home for the value, permanently, that every future reader has to
know about.

Nothing needs the fallback, and the reasoning is worth keeping because the
temptation to "be safe" here is strong:

- A version declared nowhere at the root already means **supported** —
  that is the long-standing rule for files predating the field, unchanged.
  So a project carrying the version on a collection reads as *absent*,
  defaults to the current version, and **opens normally**.
- The case a fallback appears to protect — a *newer* version on a
  collection — has no producer. No build writes that position any more,
  and the builds that did only ever wrote `1`. The set of files a
  collection-scanning reader would catch and a root-only reader would miss
  is empty, and stays empty.

## Documents written before the move

Their collection-level key is **inert data**: nothing reads it, so it
cannot influence anything. It disappears on the next save the user asks
for, and that is the whole of the migration story:

- **Opening writes nothing.** At load the value is dropped from the
  collection *in memory*, before the reactive wrap and before the
  content-checksum baseline, so the document is not marked dirty and no
  save is triggered.
- **The next user-initiated save writes the document without it**, because
  the collection model no longer carries the field. That save was going to
  rewrite the whole document anyway.

The in-memory drop is not what makes the old key harmless — the read
contract already does that. It is what makes the key actually go away: the
renderer serializes the parsed objects back wholesale, so an unknown key
round-trips, and without the drop every save would faithfully rewrite the
stale value for ever.

Silently rewriting a file the user only opened is precisely the defect the
identity stamp had and no longer has (see
`electron-core-ui/docs/Architecture/Persistence.md`); this field does not
get to reintroduce it.

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

| The document root declares | Behaviour |
| --- | --- |
| nothing (a file predating the field, or one carrying the version on a collection) | Defaults to the current version in memory. The document is **not** marked dirty — a default applied at load must not look like a user edit. |
| a version ≤ current | Opens normally. |
| a version > current | **Refused.** The document is not loaded, the previously open project stays open, and the user gets a localized message telling them to update Restorm. |

Only the root row exists on purpose: a value anywhere else is not consulted.

The refusal is deliberate, and the alternative was worse. Loading a
future-format file "as if it were current" produces a partial read, and the
next save writes the running build's impoverished understanding back over
the file — destroying the parts it did not understand. That failure is
invisible at the moment it happens and irreversible by the time anyone
notices, which is why the gate refuses rather than trying its best.

## Where the check lives

- `checkFileFormatCompatibility(content)` —
  `src/shared/config/fileFormatVersion.ts`. Pure, never mutates, and
  returns `{ supported, found, current }`. This is the gate, and it reads
  the document root and nothing else.
- `resolveFileFormatVersion(content, logger)` — same module. Answers "which
  version is this document?" (its root value, else the current one) for the
  caller to write back at the root on the next save. It cannot refuse
  anything, which is exactly why the gate is a separate function.
- `stripLegacyFileFormatVersion(collectionRoot)` — same module. Drops the
  collection-level key in memory at load. Not a read path — its job is to
  stop an unknown key round-tripping through the save payload for ever.
Anything that merely *reports* on the open project — the `restorm://project`
MCP resource — uses `resolveFileFormatVersion` too, not a separate "what does
it literally declare" reader. One function, one answer.

The open path consults the gate before anything is written or loaded:

The gate is installed as `validateOnOpen` on the `FileService` config
in `src/main/index.ts`. The library calls it after parsing and before
stamping the project UUID, so a refused file is never written to.

A refusal broadcasts `file:open-rejected`; the renderer owns the message,
because the main process ships only two locales and the renderer ships all
of them.

## Adding a new way to open a project

Any new entry point that parses a `.restorm` must call
`checkFileFormatCompatibility` before it loads or writes anything. If it
does not, `resolveFileFormatVersion` logs a warning saying the gate was
bypassed — that warning is the signal that a path was added without one.

A new entry point that WRITES must put the version at the root of what it
writes.
