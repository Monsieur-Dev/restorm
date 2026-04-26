# Playbook — Adding a New Import Format to Restorm

> **Status:** authoritative reference for import-format work.
> Companion to [`adding-a-protocol.md`](./adding-a-protocol.md). Follow this
> doc when the new ticket adds a **spec parser** (Postman, Insomnia,
> AsyncAPI, OData CSDL, ...) without introducing a new wire-level
> execution protocol. If you are also adding a new execution protocol,
> follow `adding-a-protocol.md` first; this doc only covers the import
> half.

The hard rules from `adding-a-protocol.md` still apply to any UI you build
for the importer (Sections 2–4 on component reuse, Handlebars, debouncing).
Everything else below is import-specific.

---

## Files you'll touch

```
restorm/
├── src/main/services/import/
│   ├── <Format>ImportService.ts                # the adapter
│   └── transformers/...                        # if a multi-step pipeline is needed
├── tests/unit/
│   ├── <Format>ImportService.test.ts
│   └── fixtures/<format>/...                   # representative sample(s)
├── tests/e2e/bdd/<format>-import/
│   ├── features/<format>-import.feature
│   └── steps/<format>-import.steps.ts
└── docs/imports/<format>.md                    # user-facing
```

If the format ships sample files for the welcome screen / file picker,
also drop a representative sample under `restorm/Samples/` so users have
a one-click way to try it.

---

## Section 1 — `ImportAdapter.extractNormalizedSpec` contract

Every import service implements `ImportAdapter` from
`restorm/src/main/services/import/ImportManager.ts`:

```ts
interface ImportAdapter {
  /** Stable identifier — the value used in the import-format dropdown. */
  readonly format: string

  /** Cheap content sniff: does this adapter own `source`? */
  canImport(source: ImportSource): boolean

  /** Heavy parse + normalization. Idempotent: same input → same output. */
  extractNormalizedSpec(source: ImportSource): Promise<NormalizedSpec>
}
```

* **`canImport`** must be cheap — leading-byte sniff, root field check,
  filename extension. It runs against every adapter on every import
  attempt; an O(n) parse here would tank the dispatch.
* **`extractNormalizedSpec`** does the real work. It must be **idempotent**:
  re-importing the same input twice produces the same normalized spec
  (same ids, same order). This is what makes the idempotent re-import
  pipeline safe to re-run.
* If a `NormalizedSpec` shape isn't available in the codebase when you
  start, fall back to the inline pattern used by `SwaggerImportService`
  and open a follow-up issue to migrate once it lands.

---

## Section 2 — Auto-detection

The user should not have to pick a format from a dropdown. Add a content
sniff in your adapter's `canImport`:

* **Leading-bytes sniff** for binary or near-binary formats. Read the
  first 256 bytes; check magic numbers / UTF-8 BOM / known root tag.
* **Root-field sniff** for JSON. Parse only as far as the first object
  and look for a discriminator (`openapi`, `asyncapi`, `info.x-postman`,
  `_type === 'export'`, ...).
* **Extension sniff** as a last resort. It's the weakest signal — users
  paste content as often as they pick files — but a useful tiebreaker
  (`.proto` → gRPC, `.wsdl` → SOAP).

Never put detection logic in `ImportManager` itself. The manager
dispatches to whichever adapter says `canImport === true`. If two
adapters claim the same source, the manager picks the most specific
(longest matching prefix wins) — keep your sniff narrow.

---

## Section 3 — Idempotent re-import

Re-importing the same spec must not duplicate folders / requests. The
generic `ImportManager` handles dedup using stable ids derived from
`extractNormalizedSpec` output. To stay compatible:

* Generate ids from the source spec's natural identifiers (operation id,
  message id, fully-qualified service name) — never from `Date.now()` or
  insertion order.
* If the source spec has no natural id, hash the content (e.g.
  `sha1(method + path)` for OpenAPI operations) so the same input
  produces the same hash.
* If a request has user-edited fields (notes, tags, custom env vars,
  custom enums), the merge layer keeps the user's edits and only
  overwrites parser-owned fields. Don't fight the merge layer — emit
  clean parser-owned values and trust the reconciliation.

---

## Section 4 — Custom-vs-imported reconciliation

If the format carries enums (Swagger enums, AsyncAPI message kinds,
gRPC enum types), wire into the custom-vs-imported reconciliation so
user-defined enum values added in Restorm survive a re-import:

* Emit enum metadata as `EnumDefinition` in the normalized spec so the
  importer recognizes it as parser-owned.
* User-added values stay outside the imported set; the merge keeps both.
* Test it: import → user adds an enum value → re-import → assert the
  user's value is still present, the parser's values are refreshed.

---

## Section 5 — Fixtures and unit tests

* **Fixture files** live under `restorm/tests/unit/fixtures/<format>/`.
  Commit at least one minimal valid spec and one realistic spec
  (precedent: `swagger-petstore.json`, `asyncapi-petstore.yaml`). Keep
  fixtures small — under ~10 KB each unless the format genuinely needs
  more.
* **Unit tests** live alongside other importer tests at
  `restorm/tests/unit/<Format>ImportService.test.ts`. At minimum cover:
  * `canImport` returns true for the fixture and false for a wrong-
    format input.
  * `extractNormalizedSpec` produces stable output for the fixture
    (snapshot test, or explicit shape assertions).
  * Idempotency: calling `extractNormalizedSpec` twice yields equal
    output (referentially or structurally).
  * Auto-detection: feed a corrupted-then-fixed spec and assert
    detection survives the fix.

---

## Section 6 — E2E coverage

Every import format ships an E2E feature file under
`restorm/tests/e2e/bdd/<format>-import/`. The minimal scenario set:

```gherkin
Feature: <Format> import end-to-end

  Scenario: Import the sample spec
    Given a fresh single-file collection
    When I import the sample file "<format>-petstore.<ext>"
    Then the sidebar should contain the folder "<expected root>"
    And the sidebar should show a child of "<expected root>"

  Scenario: Re-import is idempotent
    Given a fresh single-file collection
    When I import the sample file "<format>-petstore.<ext>"
    And I import the sample file "<format>-petstore.<ext>"
    Then exactly 1 root folder named "<expected root>" should be in the sidebar

  Scenario: Auto-detection picks <format>
    Given a fresh single-file collection
    When I open the import modal
    And I paste the sample file "<format>-petstore.<ext>" into the import source
    Then the import preview should be visible
    And the detected format should be "<format>"
```

If the format introduces new sample files, add them to the
`full-workflow.feature` import sweep so the regression net catches
breakage of the generic importer.

---

## Section 7 — Documentation

User-facing doc at `restorm/docs/imports/<format>.md`. Cover:

* What the format is and what spec versions you support.
* How to import (file vs. URL vs. paste).
* Which fields map to which Restorm concepts (folders, requests,
  variables, enums).
* Known limitations vs. the source spec — e.g. "AsyncAPI: bindings other
  than `kafka` and `mqtt` are silently dropped". Be explicit so users
  don't think it's a bug.

Index entry in `restorm/docs/imports/index.md`.

---

## Section 8 — PR checklist

The protocol PR template at
[`.github/PULL_REQUEST_TEMPLATE/protocol.md`](../../../.github/PULL_REQUEST_TEMPLATE/protocol.md)
is geared toward execution-protocol tickets. For an import-only PR, fill
out a stripped-down version inline in the PR description:

```
- [ ] `extractNormalizedSpec` implemented and idempotent.
- [ ] `canImport` does cheap content-sniffing — no full parse.
- [ ] Auto-detection works for paste / file / URL paths.
- [ ] Enum reconciliation wired (if format has enums).
- [ ] Fixture committed under `restorm/tests/unit/fixtures/<format>/`.
- [ ] Unit tests cover sniff + parse + idempotency.
- [ ] E2E feature file covers import + re-import + auto-detect.
- [ ] Sample file added to `restorm/Samples/` and to `full-workflow.feature`.
- [ ] User-facing doc + index entry committed.
```

---

## Reference implementations

| Format | Service | Notes |
| --- | --- | --- |
| OpenAPI / Swagger | `SwaggerImportService.ts` | Reference for JSON/YAML adapters with enum support. |
| Postman | `PostmanImportService.ts` | Reference for collection-style imports. |
| Insomnia | `InsomniaImportService.ts` | Reference for vendor-specific JSON. |
| Bruno | `BrunoImportService.ts` | Reference for filesystem-tree imports. |
| AsyncAPI | `AsyncAPIImportService.ts` | Reference for event-driven specs. |
| GraphQL SDL | `GraphQLImportService.ts` | Reference for IDL-style specs. |
| gRPC `.proto` | `GrpcImportService.ts` | Reference for IDL with codecs. |
| SOAP WSDL | `SoapImportService.ts` | Reference for XML-shaped specs. |
| OData EDMX | `ODataImportService.ts` | Reference for the Phase-1 EDMX v4 parser. |
| cURL | `CurlImportService.ts` | Reference for single-request paste imports. |
| PowerShell `Invoke-WebRequest` | `PowerShellImportService.ts` | Reference for shell-snippet paste imports. |

Pick the closest semantic match and use it as a structural guide.
