# API Blueprint import

Restorm imports [API Blueprint](https://apiblueprint.org/) (`.apib`)
documents — a Markdown-based API description format originally from Apiary
(now dormant, but still found in legacy docs). One request is generated per
documented transition (method + response pair), grouped into a folder per
resource group.

## Parser choice

API Blueprint is parsed via [`drafter.js`](https://www.npmjs.com/package/drafter.js),
a pure-WASM (Emscripten) build of the reference Drafter C++ parser, rather
than the native `protagonist` addon that the `drafter` npm package also
bundles. The WASM build needs no `node-gyp` rebuild step: it loads
identically under plain Node and under Electron's bundled V8, so packaging
the app never has to recompile a native addon against Electron's ABI. The
importer uses `drafter.js`'s synchronous `parseSync` entry point.

The parser returns an **API Elements (refract)** tree — every node, including
primitives, is wrapped as `{ element, meta?, attributes?, content }` — not
the simplified JSON shape some drafter tooling exposes via a `type: 'ast'`
option. `ApiBlueprintImportService.ts` and
`transformers/apiBlueprintToApiDocumentation.ts` walk that tree directly.

## How to import

* **File / paste** — *File → Import* and either pick a `.apib` file or paste
  its content. Auto-detection recognises the `.apib` extension or content
  starting with the `FORMAT: 1A` header — no format needs to be picked
  manually.

## What maps to what

| API Blueprint | Restorm |
| --- | --- |
| `# <Api Name>` (root category) | Root `EnvironmentFolder` name |
| `HOST` metadata | `baseUrl` environment variable (falls back to `localhost:3000` when absent) |
| `# Group <Name>` (resource group) | Folder |
| Ungrouped resources | Folder named "Other" |
| `## <Title> [<href>]` (resource) + `### <Title> [<METHOD>]` (transition) | One `HTTPRequest` per transition, named after the transition title |
| URI Template `{var}` in the resource `href` | `{{var}}` Handlebars placeholder in the request URL + a path parameter |
| URI Template `{?a,b}` query-expansion group | Query parameters (stripped from the URL, listed under `params`) |
| `+ Parameters` (`hrefVariables`) | Typed path/query parameters (number/boolean/string), with description carried over |
| Request `+ Headers` / `+ Attributes` | Request headers / body |
| Request `+ Attributes` example body (`+ Request`) | Request body (from the generated message-body example) |
| `# Data Structures` named types | `ApiDocumentation.models` (object properties + enum values), cross-referenced from array/object-typed properties |

## Known limitations

* A transition with several `+ Request` / `+ Response` example pairs
  generates one request **per pair** rather than merging them — each extra
  pair gets a `#<index>` suffix on its natural key so re-imports stay stable.
* **MSON** (Markdown Syntax for Object Notation) beyond what `drafter.js`
  resolves into API Elements is out of scope — deeply nested inline object
  types are surfaced with a generic `object` type rather than fully expanded.
* Hosted Apiary features (mocks, machine-generated tests) have no equivalent
  here; only the document structure itself is imported.
