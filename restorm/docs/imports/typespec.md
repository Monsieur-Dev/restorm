# TypeSpec import

Restorm imports Microsoft [TypeSpec](https://typespec.io) (`.tsp`) API
definitions by compiling them to OpenAPI 3.x and delegating to the existing
OpenAPI importer — the same folder / request / documentation shape you get
from importing a hand-written OpenAPI spec.

## Strategy A — compile via Restorm's OWN bundled `tsp`, then delegate (implemented)

`TypeSpecImportService.ts` shells out to a `tsp` CLI (the
[`@typespec/compiler`](https://www.npmjs.com/package/@typespec/compiler)
package) rather than parsing `.tsp` syntax itself — but a copy Restorm
ships, not one the user needs to install (see Install requirement below):

1. Copy the `.tsp` CONTENT into a fresh, isolated temp directory (never the
   file's real location — see Security below) and symlink Restorm's own
   `node_modules` into it.
2. Run the compiler's own JS entry point via `process.execPath <tspCliEntry.js>
   compile <isolated copy> --emit @typespec/openapi3 --output-dir <temp dir>`
   with `ELECTRON_RUN_AS_NODE=1` — Electron's own bundled binary running as
   plain Node, not a `tsp` binary resolved via `PATH` (see Security below).
3. Read the emitted `openapi.yaml` (found by searching the output directory,
   since the emitter's exact nesting is an implementation detail of
   `@typespec/openapi3`, not a documented contract).
4. Parse it and hand the resulting document to `importOpenAPI` — the same
   entry point `OpenAPIImportService` uses for hand-written specs.
5. Delete both temp directories.

This ships faster than a from-scratch `.tsp` parser and inherits every
improvement made to the OpenAPI importer (enum reconciliation, security
scheme wiring, tag-based folder grouping, …) for free. The tradeoff: the
emitted OpenAPI document is only as complete as `@typespec/openapi3`'s own
coverage of the TypeSpec surface (most third-party TypeSpec libraries emit
cleanly; some vendor-specific decorators may be dropped by the emitter
itself, before Restorm ever sees the output).

**Strategy B (direct `.tsp` parsing via the compiler's programmatic API,
bypassing OpenAPI entirely) is not implemented.** It would be more
self-contained (no external OpenAPI hop) but heavier to build and maintain.
Revisit if user demand justifies it.

## Security — isolated compilation

`tsp compile` doesn't just parse text — it **executes** the decorator
libraries and emitters the `.tsp` file references, and any `tspconfig.yaml`
sitting next to it. Naively compiling the file in its own real directory
would resolve both via Node module resolution rooted at that directory,
meaning a `.tsp` shipped alongside a malicious `node_modules` /
`tspconfig.yaml` could execute arbitrary code during import — the same
trust boundary as running `npm install` or any other build tool against an
untrusted project.

To avoid that, Restorm never compiles the file in place. It copies only the
`.tsp` **content** into a fresh, isolated temp directory that has no
relationship to the original file's location, and symlinks Restorm's own
`node_modules` into it. `import "@typespec/http"` (and the `--emit
@typespec/openapi3` emitter itself) therefore always resolves to the
library version Restorm ships, never anything from the imported file's real
directory — a `tspconfig.yaml` or `node_modules` sitting next to the source
file is never consulted, regardless of what it declares.

The compiler itself is also Restorm's own, and is invoked without touching
`PATH` at all: `resolveTspCliEntry` reads the `bin.tsp` entry out of
Restorm's own bundled `@typespec/compiler` package to find its JS file, and
`importTypeSpec` runs it as `process.execPath <that .js file> compile ...`
with `ELECTRON_RUN_AS_NODE=1` — Electron's own embedded binary running as a
plain Node process. This is deliberately NOT `node_modules/.bin/tsp` (pnpm's
usual shell shim) — that shim internally execs a system `node`, which a
packaged Electron app doesn't guarantee is present. Running the compiler's
JS entry directly through Electron's own Node means nothing external to
Restorm — no global `tsp`, no system `node` — is ever required, in dev or in
a packaged build. If Restorm's own bundled compiler can't be located (a
broken/incomplete install), the import fails closed with a clear error
rather than ever falling back to resolving against the untrusted source
directory — see `findAncestorNodeModulesWithTypeSpecCompiler` in
`TypeSpecImportService.ts`.

**Tradeoff:** relative imports to sibling `.tsp` files (multi-file TypeSpec
projects, e.g. `import "./models.tsp"`) don't resolve, since only the single
entry file's content is copied into isolation — single-file specs only (see
Known gaps). This is the same containment bar Restorm applies to other
compiler-shaped import formats.

The `tsp` child process additionally runs with `NODE_OPTIONS` and
`NODE_PATH` stripped from its environment (everything else is passed
through), so a value inherited from Restorm's own process can't be abused to
inject a `--require` or an out-of-tree module-resolution root into the
compiler's Node invocation — a small extra hardening measure on top of the
isolation itself.

## Install requirement

**None.** `@typespec/compiler`, `@typespec/http`, `@typespec/openapi`, and
`@typespec/openapi3` are real `dependencies` of Restorm (bundled into every
build, dev and packaged) — there is no global `tsp` to install, no
project-level TypeSpec libraries to add, and (since the compiler runs
through Electron's own embedded Node — see Security above) no system Node
required either. Restorm's own bundled compiler and libraries are used for
every import, regardless of what (if anything) is installed on the user's
machine.

In the unlikely event Restorm's own bundled compiler is missing or broken (a
corrupted install), the import fails immediately with a clear, actionable
message:

> TypeSpec compiler is missing from this Restorm installation — this looks like a broken or incomplete install; try reinstalling Restorm.

— not a raw ENOENT stack trace — surfaced through the same `ImportResult.error`
field every other importer uses, so the Import modal displays it like any
other import failure.

## File-based only

Unlike most Restorm importers, TypeSpec import **only accepts a real file on
disk** — paste and URL import aren't supported. This is a deliberate scope
decision to keep the contract simple, not a technical necessity of the
isolated-compilation design (the isolated copy would work identically from
pasted text). Detection (`canImport`) is a plain `.tsp` extension check;
there is no content-based auto-detection to fall back to for paste.

## Known gaps

* No round-tripping — changes made to the imported requests in Restorm don't
  flow back into the source `.tsp` file (out of scope, see the parent
  ticket's epic).
* **Single-file specs only** — the isolated-compilation trust boundary (see
  Security above) copies only the entry file's content, so a `.tsp` that
  relatively imports sibling files (`import "./models.tsp"`, a multi-file
  TypeSpec project) fails with an unresolved-import error. Splitting such a
  project isn't supported; paste the whole spec into one file if possible.
* Multi-emitter TypeSpec projects (a single `.tsp` set up to emit Protobuf +
  OpenAPI + JSON Schema together) are not specifically handled — Restorm only
  ever asks for the `@typespec/openapi3` emitter, ignoring any other emitters
  the project's own `tspconfig.yaml` might declare (moot anyway once
  isolated — the project's own `tspconfig.yaml` is never consulted).
* No bundled try-it-out sample: `restorm/Samples/` holds full `.restorm`
  project files, not raw import-source specs, matching every other importer
  in this repo (there's no sample Swagger/proto/WSDL file there either).
  The fixture at `tests/unit/fixtures/typespec/petstore.tsp` (plus its
  compiled `petstore.openapi.yaml`) is the reference example instead.
* The `process.execPath` + `ELECTRON_RUN_AS_NODE` invocation is verified in
  dev and via the unit/integration suites, but can't be exercised against an
  actual signed/packaged build yet — that pipeline doesn't exist until a
  later milestone. The design (Electron's own binary running as plain Node)
  is the standard pattern for this exact problem and doesn't depend on
  anything the packaging step would change, but treat the packaged-app path
  as unverified until it can be smoke-tested for real.
