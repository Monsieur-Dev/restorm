# Restorm project import (merge two projects)

Restorm imports another **`.restorm` project file into the project you have
open** — a merge of two projects, not a replacement. Everything the source
file contains (folders, requests, environments and their variables, custom
value lists, enum definitions, scenarios) lands in the open project under
**one wrapping folder named after the source file**, so the merge stays
legible in the sidebar and is reversible with a single delete.

## How to import

*Créer → Importer…* (Ctrl+I) and pick / drag-drop the `.restorm` file, or
paste its raw YAML. No format needs to be picked manually — the importer
claims the `.restorm` extension, and pasted content is recognised by the two
root keys every saved project carries (`fileFormatVersion` + `collections`).

## Fresh identities, by design

Every imported document element — folders, requests, environments and
sub-environments, enum definitions, custom value lists, scenarios with their
nodes and edges, quick configs — receives a **newly generated id**, and every
internal reference between imported elements (folder hierarchy, scenario-node
→ request bindings, scenario edges, quick-config bindings, auth routes,
enum-definition references, custom-value-list references) is remapped onto
the new ids in the same pass. (Key-value *rows* — headers, params, variable
entries — are the one exclusion: their ids are never persisted and de-dupe
themselves on the next load.) Consequences:

* Nothing in the imported set can collide with — or overwrite — anything in
  the open project, even when both files share history.
* **Importing a project into itself is well-defined**: it produces a clean,
  fully independent duplicate set alongside the originals.
* This deliberately diverges from the spec importers' idempotent re-import
  behaviour: re-importing the same `.restorm` twice yields **two**
  independent copies, never a dedup. For a project merge, duplication is the
  point — a dedup would silently discard data.

## File-format gate

The import applies the exact same compatibility gate as opening the file:

* a file declaring a **newer** `fileFormatVersion` than this build
  understands is refused (update Restorm first);
* a file declaring **no** version at its root is refused — every Restorm
  save stamps one, so its absence means the file is not a Restorm project.

## What's intentionally not imported

* **Secret values.** An `envFileSecret` variable's plaintext lives in the
  source project's `.restorm.env` sidecar, keyed by that project's layout.
  The variable *structure* is imported; the secret stays unresolved until
  filled in again. Response history (`.responses.zip`) is likewise left
  behind — it belongs to the source project.
* **Spec-import hygiene.** Unlike external spec importers, empty key-value
  rows are NOT auto-disabled: the content is user-authored Restorm data,
  imported exactly as it was saved.
* There is no refresh-from-source: like a cURL paste or a HAR capture, this
  is a one-shot import with no `apiUpdate` config attached.
