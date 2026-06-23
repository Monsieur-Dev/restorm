# Extending the OData `$filter` autocomplete grammar

> Reference for the metadata-driven `$filter` (and `$orderby`) autocomplete
> in the OData request panel. Read this when you need to teach the grammar a
> new operator, function, or value-suggestion pattern.

The `$filter` input is a Monaco single-line editor running a custom
`odata-filter` language. Everything is driven by two **pure, Monaco-free**
modules so the suggestion + validation logic is unit-tested in isolation:

```
src/shared/utils/odataFilter/
  odataFilterGrammar.ts    # tokenizer + cursor classifier (no metadata)
  odataFilterMetadata.ts   # property / operator / value resolvers (metadata)
src/renderer/src/services/monaco/
  odataFilterLanguage.ts   # thin Monaco shell: completion / hover / markers
src/renderer/src/components/RequestTabViews/
  ODataFilterEditor.tsx    # wires the language into the panel
```

## How a suggestion is produced

1. `classifyCursor(text, offset)` (grammar) tells us **what** the cursor
   position expects: a `property`, an `operator`, a `value`, a `logical`
   connector, or nothing (inside a `{{template}}` span). It also returns the
   owning property path for operator / value positions.
2. The metadata resolvers turn the request's bound entity type
   (`request.entityTypeRef` resolved against the env folder's
   `apiDocumentation.models`) into the concrete list:
   - `propertiesFor(model)` — structural + navigation properties.
   - `operatorsForType(edmType, isEnum)` — type-appropriate comparison /
     membership operators.
   - `functionsForType(edmType)` — string functions for `Edm.String`.
   - `valueSuggestionsForProperty(prop, apiDoc)` — enum members, `true`/
     `false`, date / GUID placeholders.
3. `odataFilterLanguage.ts` maps those lists into Monaco completion items.

No metadata (a hand-authored request with no `entityTypeRef`, or a folder
with no imported spec) means every resolver returns an empty list: the editor
silently offers no suggestions and never throws.

## Recipes

### Add a new comparison / membership operator

Operators live in `COMPARISON_OPERATORS` in `odataFilterGrammar.ts` (lexing)
and are gated per type in `operatorsForType` / `isOperatorValidForType` in
`odataFilterMetadata.ts` (which list is offered + which raises a wrong-type
warning). Add the keyword to `COMPARISON_OPERATORS`, then decide its type
rules in those two functions. Add a unit case to
`tests/unit/odataFilterMetadata.test.ts`.

### Add a new filter function

Add the name to `FILTER_FUNCTIONS` (lexing) in `odataFilterGrammar.ts`. If it
is string-only, also add it to `STRING_FUNCTIONS` in `odataFilterMetadata.ts`
so it's offered only for `Edm.String` properties. The completion provider
inserts `name($0)` as a snippet automatically.

### Add a value-suggestion shape for a new Edm type

Extend `valueSuggestionsForProperty` in `odataFilterMetadata.ts`. The property
carries a `format` hint (set by the importer in `ODataImportService.ts` via
`edmFormatHint`) plus its `targetModelRef` for enum linkage — branch on those.
For a brand-new format, teach `edmFormatHint` to emit it first.

### Change the validation rules

Light validation (unknown property → error, wrong-type operator → warning)
lives in `validateODataFilterModel` in `odataFilterLanguage.ts`, driven by
`isOperatorValidForType`. Tokens inside `{{template}}` spans are never
validated.

## Invariants

- **`{{env.var}}` stays opaque.** The tokenizer emits a single `template`
  token for a `{{…}}` span; the classifier returns `inTemplate` so completion
  + validation skip it. Runtime resolution is unchanged — it happens in the
  serializer, not the editor — so env templating keeps working inside
  `$filter`.
- **Pure logic, no Monaco in unit tests.** Keep new logic in the two
  `odataFilter/` modules and unit-test it directly; Monaco is exercised by the
  E2E layer (the renderer loads it for real). Do not import Monaco into the
  grammar / metadata modules.
- **Metadata refresh needs no reload.** Providers read the per-model metadata
  map live, and `ODataFilterEditor` re-applies it whenever the resolved
  `apiDocumentation` changes — a re-import of `$metadata` updates the
  suggestion set in place.
