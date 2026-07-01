# RAML import

Restorm imports RAML (RESTful API Modeling Language) specifications and maps
them onto a folder of ready-to-run requests — one sub-folder per resource,
nested to mirror the RAML resource tree, with one request per HTTP method.

## Supported inputs

| Input | Detector | Version | Parser |
| --- | --- | --- | --- |
| RAML 1.0 (`#%RAML 1.0` header) | leading comment / `.raml` extension | 1.0 | `raml-1-parser` |
| RAML 0.8 (`#%RAML 0.8` header) | leading comment / `.raml` extension | 0.8 (best-effort) | `raml-1-parser` |

`src/main/services/import/RamlImportService.ts` sniffs the mandatory leading
`#%RAML 1.0` / `#%RAML 0.8` comment (or a `.raml` file extension) and hands
the content to `raml-1-parser`. RAML 1.0 gets full support; RAML 0.8 is
best-effort — the older artifact exposes a narrower AST (`Parameter` /
`BodyLike` instead of `TypeDeclaration`), so anything beyond the resource /
method / parameter shapes RAML 0.8 shares with 1.0 is not specifically
handled.

> `raml-1-parser` is the reference RAML 1.0 parser, but the upstream package
> itself carries a deprecation notice pointing at `webapi-parser` as its
> successor. `webapi-parser`'s API is promise-only, while Restorm's import
> providers must parse synchronously — `raml-1-parser` remains the only
> dependency-free package that satisfies that constraint, so it is used
> deliberately despite the upstream notice.

## How to import

* **File / paste** — drag-and-drop the `.raml` file, or paste its content,
  into *File → Import*. Auto-detection recognises the `#%RAML` header.
* **URL** — paste a URL serving the raw RAML document.

## What maps to what

| RAML | Restorm |
| --- | --- |
| `baseUri` | Root environment's `baseUrl` variable (Handlebars-templated: `{version}` → `{{version}}`) |
| `resources` (nested `/path` tree) | Nested `Folder` tree, one folder per resource |
| `methods` (`get`/`post`/…) | One `HTTPRequest` per method, under its resource's folder |
| `queryParameters` / `headers` / `uriParameters` | Request `params` / `headers` / `pathParams` |
| `body` | Sampled JSON request body (named types resolved recursively) |
| `types` (data type declarations) | `ApiDocumentation.models` (rendered in the Docs tab) |
| `securitySchemes` | `ApiDocumentation.securitySchemes`; `Basic Authentication` and `OAuth 2.0` additionally pre-wire an `Authorization` header (`Basic {{scheme}_credentials}}` / `Bearer {{scheme}_token}}`) on every method that references them via `securedBy` |
| `traits` / `resourceTypes` | Expanded inline before the resource tree is walked (`Api.expand()`), so their headers/params/responses appear on the methods that apply them |

## Known limitations

* **External type references** — RAML type definitions that pull in an
  external JSON Schema or XSD file (`type: !include foo.json`) are not
  resolved; only inline RAML type declarations are mapped.
* **Fragments / libraries** — `uses:` library imports and standalone RAML
  fragments (`#%RAML 1.0 Library`, `#%RAML 1.0 Trait`, …) are not merged;
  only a single self-contained RAML document (with its own inline
  `resourceTypes` / `traits` / `types`) is supported.
* **Security schemes beyond Basic / OAuth 2.0** — Digest, Pass Through,
  OAuth 1.0 and custom (`x-*`) schemes are recorded in the documentation
  viewer but do not pre-wire an `Authorization` header; add one manually if
  the API requires it.
* **RAML 0.8** — supported best-effort only; favour re-authoring a legacy
  0.8 spec as 1.0 if you hit a gap.
