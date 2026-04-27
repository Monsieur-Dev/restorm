# OpenAPI / Swagger import

Restorm imports three flavors of OpenAPI specifications:

| Spec | Detector | Service | Transformer |
| --- | --- | --- | --- |
| Swagger 2.0 | `swagger: "2.0"` | `SwaggerImportService.ts` | `transformers/swaggerToApiDocumentation.ts` |
| OpenAPI 3.0.x | `openapi: "3.0.*"` | `OpenAPIImportService.ts` | `transformers/openapi3ToApiDocumentation.ts` |
| OpenAPI 3.1.x | `openapi: "3.1.*"` | `OpenAPIImportService.ts` | `transformers/openapi31ToApiDocumentation.ts` |

The 3.1 transformer is a thin shim over 3.0: it normalises `type: ["string", "null"]`
to 3.0-style `nullable: true`, plural `examples` to a singular `example`, and
hands the result to the 3.0 transformer. Webhooks (a 3.1-only block) are
imported as a separate `Webhooks` folder marked documentation-only — there is
no execution endpoint for an incoming notification.

The version-agnostic helpers (parameter mapping, response mapping, `$ref`
walker, schema label rendering) live in `transformers/_shared.ts` and are
shared across all three transformers.

## How to import

Three entry paths:

* **File** — drag and drop, or pick via *File → Open*.
* **URL** — *File → Import* and paste an HTTP(S) URL. Restorm fetches the spec
  with optional auth headers.
* **Paste** — *File → Import* and paste raw JSON / YAML.

In every case the format is auto-detected. Sniffing is content-based: a JSON
root field of `swagger: "2.0"` routes to the 2.0 importer; `openapi: "3.0.*"`
routes to the 3.0 importer; `openapi: "3.1.*"` routes to the 3.1 importer.
A spec advertising a future major version (e.g. `4.0.0`) is left undetected —
Restorm surfaces a clean *"Could not detect file format"* error rather than
silently misimporting.

## Mapping

| OpenAPI concept | Restorm concept |
| --- | --- |
| `info.title` | Root environment folder name |
| `tags[]` | Sub-folders inside the environment folder |
| `paths` operations | `HTTPRequest`s under their tag's folder (or `Other` when untagged) |
| `parameters` (query/path/header) | `request.params` / `request.pathParams` / `request.headers` |
| 3.x `requestBody.content` | `request.body` — the JSON content type wins; XML / form variants are preserved on the `apiDocumentation` for the rendered docs |
| 3.x `responses[code].content` | `apiDocumentation.operations[].responses[code]` — primary content schema name |
| 2.0 `definitions` / 3.x `components.schemas` | `apiDocumentation.models` |
| 2.0 `host` + `basePath` + `schemes` | `Environment` with structured `scheme`/`host`/`port`/`baseRoute` + a `baseUrl` Expression |
| 3.x `servers[]` | First entry → root environment, additional entries → sub-environments. Server-template variables (`{var}`) become env vars; the URL is stored as a Handlebars `{{var}}` Expression |
| 3.x `components.securitySchemes` | Persisted on `apiDocumentation`. The auth-route wizard reads them when wiring an `AuthenticationRequest`. |

OpenAPI's `{var}` path templates are rewritten to Handlebars `{{var}}` at
import time, so resolution at execution time goes through `ContextService`
exactly like every other variable. Path-item-scoped `parameters[]` are
inherited by every operation under that path unless the operation overrides
them by `(name, in)` pair.

## Enums

JSON-Schema `enum` values declared on a route parameter are extracted into
`EnumDefinition`s on the root environment folder:

* The `matchingRules[]` carry `(method, pathPattern, paramName)` so the
  route's parameter renders as a typed `EnumValue` / `EnumListValue` immediately
  after import.
* Enums declared in `components.schemas` (3.x) / `definitions` (2.0) but
  never referenced by a route are still imported — they show up under
  *API defined types* in the enum picker for manual assignment.
* User-added enum values survive a re-import: the parser only owns the
  imported set; new values stay outside it and the merge layer keeps both.

## Multi-content-type bodies

When an operation declares more than one media type:

* The `request.body` is materialised from the JSON entry when present;
  otherwise the first declared content type wins.
* `application/x-www-form-urlencoded` and `multipart/form-data` bodies flatten
  the schema's properties into `KeyValue` rows and store the body as
  `form-data` / `x-www-form-urlencoded` (not as a JSON sample).
* The full content map is preserved on `apiDocumentation.operations[].consumes`
  so the rendered docs list every supported media type.

## Multi-server specs

`servers[]` with one entry → one root environment with a `baseUrl` Expression.
`servers[]` with several entries → the first becomes the root, the rest land
as sub-environments named after each `server.description`. Each server's
`variables` map turns into `KeyValue`s on the matching environment, with the
declared `default` (or first `enum` value) as the initial value.

## Validator

`OpenAPIImportService` exposes an opt-in `importOpenAPIValidated()` entry
point that runs the spec through `@apidevtools/swagger-parser` (which handles
both Swagger 2.0 and OpenAPI 3.x) before transforming. The default
`importOpenAPIFromJson` skips validation — the transformer tolerates `$ref`s
on its own, and validating the full spec on every import has a measurable
cost on 100 KB+ specs (Stripe, GitHub).

## Known gaps

* **`callbacks`** — parsed and ignored. Restorm has no model for inbound
  callbacks yet; a follow-up ticket will wire them up as their own folder
  type.
* **`links`** — same as callbacks: parsed and ignored.
* **`security` per-operation** — recorded on `apiDocumentation` but not yet
  applied to the materialised request. The auth-route wizard does the wiring
  when the user explicitly attaches an authentication route.
* **3.1 webhooks** — imported as documentation-only requests. There is no
  active execution endpoint (a webhook is incoming, not outgoing); a future
  ticket will allow flipping a webhook into a mock-server hook.
* **OAS Moonwalk / 4.x** — does not exist yet; currently surfaces a clean
  "Could not detect file format" error.

## Where the code lives

* Service: `src/main/services/import/SwaggerImportService.ts` (2.0) and
  `src/main/services/import/OpenAPIImportService.ts` (3.0/3.1).
* Transformers: `src/main/services/import/transformers/_shared.ts`,
  `swaggerToApiDocumentation.ts`, `openapi3ToApiDocumentation.ts`,
  `openapi31ToApiDocumentation.ts`.
* Detection / dispatch: `src/main/services/import/ImportManager.ts`.
* Fixtures: `tests/unit/fixtures/openapi/`.
