# `ImportAdapter` interface — dev note

The idempotent import / refresh pipeline is format-agnostic. Each
import format contributes a tiny `ImportAdapter` that walks its
parsed source representation and produces a normalised
`NormalizedSpec`. Everything after that — diff, conservative shape
merge, deprecation propagation, removed-flag flipping — lives in the
shared `runIdempotentImport` and is identical for every format.

Type:

```ts
interface ImportAdapter {
  format: ImportSourceType
  extractNormalizedSpec(rawSpec: unknown, options: AdapterOptions): NormalizedSpec
}
```

`format` is the discriminator the pipeline uses to match existing
requests by `importOrigin.format`. It must equal the value the
per-format import service writes to `EnvironmentFolder.importSource`
on initial import.

`extractNormalizedSpec` is **side-effect-free** — it takes a parsed
spec object (JSON, the introspection result for GraphQL, the proto
tree for gRPC, etc.) and returns:

- `version?` — the spec's own version string when available
  (`info.version` for OpenAPI, top-level `version` for GraphQL).
- `operations[]` — one `NormalizedOperation` per route / field /
  method / channel × action / etc. The pipeline indexes existing
  requests by `importOrigin.operationId` first, falling back to
  `importOrigin.naturalKey`, so both should be set when the source
  format provides a stable id.
- `models[]` + `enums[]` — flat lists. The pipeline diffs these for
  the confirmation modal counters; the per-folder `apiDocumentation`
  + `enumDefinitions` are replaced wholesale on apply.
- `environments[]` — used only on initial import. Refresh-in-place
  leaves environments alone.

Adapter implementations live in
`restorm/src/main/services/import/idempotent/<Format>Adapter.ts`.
The 10 shipped today (`Swagger`, `OpenAPI3`, `GraphQL`, `Postman`,
`Insomnia`, `Bruno`, `AsyncAPI`, `Grpc`, `Soap`, `OData`) follow the
same pattern: a thin TypeScript shape capturing only the structural
fields the adapter needs, plus a `extractNormalizedSpec` that walks
that shape.

## naturalKey conventions

Pick a deterministic anchor that survives a re-export of the same
source. The pipeline compares natural keys across runs to recognise
"this is the same operation as before" — drift here translates to
bogus add / remove tallies on every refresh.

| Format | naturalKey |
| --- | --- |
| Swagger / OpenAPI | `${METHOD} ${path}` (e.g. `GET /pets/{id}`) |
| GraphQL | `${operationType} ${fieldName}` (e.g. `query getPet`) |
| Postman / Insomnia / Bruno | `${format} ${folderPath}::${METHOD} ${name}` |
| AsyncAPI | `${action} ${channel}` (`publish pet/created`, …) |
| gRPC | `${package}.${service}/${method}` (qualified path) |
| SOAP | `${portType}/${operation}` |
| OData | `${kind} ${name}` (`entitySet Pets`, `function GetPetByName`) |

When the format also exposes a stable id beyond naturalKey
(`operationId`, `_id`, `_postman_id`, `uid`, `soapAction`), surface
it via `NormalizedOperation.operationId`. The pipeline prefers
`operationId` when matching, so a rename of the `naturalKey` (e.g.
a path change) doesn't lose the link to existing requests.

## Idempotency invariant

Every adapter is contractually `byte-identical on two parses` of the
same raw spec. Pinned by the test suite:

```ts
expect(JSON.stringify(adapter.extractNormalizedSpec(spec, {})))
  .toBe(JSON.stringify(adapter.extractNormalizedSpec(spec, {})))
```

If your adapter iterates over `Map` / `Set` instances, sort the
output before emitting; otherwise iteration order leaks into the
content hash and the checker reports false positives on every
refresh.
