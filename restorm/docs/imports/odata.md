# OData import

Restorm imports OData service metadata (CSDL) and generates a folder of
ready-to-run requests — one sub-folder per entity set (with the five CRUD
verbs) plus `Actions` and `Functions` sub-folders for the service operations.

## Supported inputs

| Input | Detector | Version | Parser |
| --- | --- | --- | --- |
| EDMX XML (`<edmx:Edmx Version="4.0">`) | `<edmx:Edmx` / `.edmx` / `$metadata` | v4 | `parseEdmx(xml, 'v4')` |
| EDMX XML (`Version="3.0"`) | same | v3 | `parseEdmx(xml, 'v3')` |
| EDMX XML (`Version="1.0"`/`"2.0"`) | same | v2 | `parseEdmx(xml, 'v2')` |
| JSON-CSDL (`{ "$Version": "4.0…" }`) | top-level `$Version` | v4 | `parseJsonCsdl(json)` |

All four live in `src/main/services/import/ODataImportService.ts` and resolve
to the same version-agnostic `EdmSchema`. The protocol version is detected by
`parseEdmxVersion` (from the `edmx:Edmx@Version` attribute, falling back to
`m:DataServiceVersion` then the EDM namespace URI) and tagged onto every
generated `ODataRequest.odataVersion` — and onto the imported root folder as an
`odata:<version>` tag for at-a-glance discoverability.

The version drives runtime behaviour: a v2/v3 request emits
`$inlinecount=allpages` (instead of v4's `$count=true`), and the response
normaliser (`odataResponse.ts`) unwraps the v2/v3 `{ d: { results, __count,
__next } }` envelope into the v4 `value` / `@odata.count` / `@odata.nextLink`
shape so the UI renders both identically.

## How to import

* **URL** — *File → Import* and paste a `$metadata` URL. Restorm fetches the
  EDMX (optionally behind a Bearer/Basic auth header sourced from an env
  variable) and derives the service `baseUrl` by stripping `/$metadata`.
* **File / paste** — drag-and-drop or paste the CSDL. JSON-CSDL is sniffed by
  its `$Version` directive; EDMX XML by its `<edmx:Edmx>` root.

The version shapes only what the importer emits; cross-version differences
between v2/v3 CSDL and v4 (older `<FunctionImport>` vs `<Function>`/`<Action>`,
no `<EnumType>` in v2) are handled by the shared `parseEdmx` pass.

## $batch wire formats

`$batch` requests serialize to one of two OData v4 formats, chosen via the
`batchFormat` toggle in the batch editor:

* **`multipart`** (default) — the classic `multipart/mixed` envelope, with
  change-sets (`atomicityGroup`) nested as `multipart/mixed; boundary=changeset_…`.
* **`json`** — the JSON batch format: a `{ "requests": [...] }` document sent as
  `application/json`, with a symmetric `{ "responses": [...] }` reply. Change-sets
  ride the per-request `atomicityGroup` member.

Both serializers + response parsers live in `src/shared/utils/odataBatch.ts`.

## Version-mismatch warning

When a response envelope contradicts the version the request is tagged with
(e.g. a v4 request that received a v2 `{ d: … }` body), the response panel
surfaces a non-blocking warning (`detectODataVersionMismatch` in
`odataResponse.ts`) prompting the user to align the request version with the
server. The response is still normalised and rendered.

## Testing

* Unit — `tests/unit/ODataImportService.test.ts` (v4/v3/v2 EDMX + JSON-CSDL
  parsers, with committed fixtures under `tests/unit/fixtures/odata/`),
  `tests/unit/odataBatch.test.ts` (multipart + JSON batch),
  `tests/unit/odataResponse.test.ts` (envelope normalisation + mismatch).
* E2E — three Playwright projects: `odata-petstore` (smoke), `odata-import`
  (multi-version + JSON-CSDL import), and `odata-execution` (query options,
  CRUD, v2 envelope, JSON batch, paging, errors). The v4 mock is the .NET
  `tests/docker/odata-petstore` (:5100); the v2 mock is a zero-dependency
  `node:http` server, `tests/docker/odata-v2-petstore` (:5102).
