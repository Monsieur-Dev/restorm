# Smithy import

Restorm imports [Smithy](https://smithy.io) models — AWS's API modeling
language — and generates a folder of ready-to-run requests: one sub-folder
per `resource` (nested for child resources) plus a top-level `Operations`
sub-folder for operations bound directly to the `service`.

## Supported inputs

| Input | Detector | Parser |
| --- | --- | --- |
| JSON AST (`smithy build` output, `{ "smithy": "1.0", … }`) | top-level `smithy` field | `parseSmithyJsonAst` |
| `.smithy` IDL (human-authored) | `.smithy` extension, or a `namespace` declaration alongside an `operation`/`resource`/`service` shape | `parseSmithyIdl` |

Both live in `src/main/services/import/SmithyImportService.ts` and parse into
the same `SmithyModel` — a namespace plus a map of shapes keyed by their
simple name — so request materialisation, documentation generation, and enum
extraction are written once and shared between the two formats.

## Text IDL parsing strategy

The `.smithy` IDL is parsed with a minimal hand-rolled grammar rather than by
delegating to `@smithy/smithy-to-openapi` (compile-to-OpenAPI, then reuse the
OpenAPI importer): every other IDL-style importer in this codebase (GraphQL
SDL, gRPC `.proto`) already follows the self-contained-parser precedent, it
avoids a new npm dependency, and — critically — converting to OpenAPI first
would throw away trait access (`@httpLabel` / `@httpQuery` / `@httpHeader`,
`@error`, `@deprecated`, …) this importer needs to shape the generated
requests. The grammar covers `namespace`, `use`, `structure`, `enum`,
`intEnum`, `operation`, `resource`, `service`, and single-line trait
annotations (`@trait` or `@trait(args)`) — enough for the REST-bound subset
this importer targets.

## How Smithy concepts map to Restorm

| Smithy | Restorm |
| --- | --- |
| `service` | Root `EnvironmentFolder` (name = service shape name) |
| `resource` | Sub-folder, nested for child resources (`resource.resources`) |
| `operation` with an `@http` trait | An `HTTPRequest` (method + URI from the trait) |
| `operation` without an `@http` trait | Documentation-only — listed in the generated docs, no request is created |
| `structure` | A model in the generated documentation |
| `enum` / `intEnum` | An `EnumDefinition` |
| `@httpLabel` member | Path parameter |
| `@httpQuery("name")` member | Query parameter |
| `@httpHeader("name")` member | Header |
| Any other input member | Request body field (skipped for `GET`/`HEAD`) |

## How to import

* **File / paste** — drag-and-drop, browse to, or paste either the JSON AST
  or the `.smithy` IDL text. Both are auto-detected; no format needs to be
  picked from a dropdown.
* The generated environment's `baseUrl` variable defaults to
  `https://api.example.com` — point it at the real service host after import.

## Known limitations (v1)

* **REST bindings only.** Non-REST Smithy protocols (`awsJson1_1`,
  `awsQuery`, …) aren't modeled — an operation without `@http` is
  documentation-only.
* **SigV4 auth is not pre-wired.** Imported requests carry no AWS
  authentication headers; add them manually or via an auth route.
* **Smithy protocol tests are ignored.**
* **Scalars, lists, maps, and unions aren't modeled as first-class shapes.**
  A member that targets one of these still becomes a body field (or a
  parameter, if bound via `@httpLabel`/`@httpQuery`/`@httpHeader`) — its
  target type just isn't expanded into the generated documentation.
* **Line comments inside string literals aren't supported** in the `.smithy`
  IDL parser (a `//` anywhere ends the line) — irrelevant for the URIs and
  trait values this importer reads, but worth knowing if a spec embeds one.
