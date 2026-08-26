# Adding a code template

The Design tab's **Code** section turns an API design into a project by
running a **Copier-format template** in a sandbox. This page is the
contract for template authors — official and community.

## Where templates come from

| Source | How | Typical use |
|---|---|---|
| Official registry | embedded in the app (`OFFICIAL_TEMPLATES` in `src/main/services/designCodegen/templateSource.ts`) | the supported stacks |
| Repository | `owner/repo` on github — fetched as a **tarball archive** through the firewall-bypassed provisioning path (never a git clone) | your fork of an official template |
| Local folder | any folder on disk | developing a template (zero network) |

Every template must carry a **`restorm-template.json`** manifest at its
root:

```json
{
  "name": "Express + TypeScript server",
  "type": "server",
  "language": "TypeScript",
  "contextVersions": [1]
}
```

`contextVersions` lists the context versions the template understands.
Restorm refuses an incompatible template **before rendering anything**,
with a message naming both versions.

## Declaring variables (optional)

A template can also **declare user-facing variables** — the values it needs
that the design itself doesn't carry (a package name, a namespace, whether to
emit Docker…). Add a `variables` array to the manifest; the user fills each
value in the design's **Code generation** panel (as a Handlebars expression),
and the resolved value lands in `ctx` for the template to read.

```json
{
  "name": "Express + TypeScript server",
  "type": "server",
  "language": "TypeScript",
  "contextVersions": [1],
  "variables": [
    { "name": "packageName", "scope": "project",  "type": "string",  "default": "my-api", "description": "npm package name" },
    { "name": "tableName",   "scope": "model",    "type": "string",  "description": "SQL table for this model" },
    { "name": "indexed",     "scope": "property", "type": "boolean", "default": "false" },
    { "name": "cache",       "scope": "route",    "type": "enum",    "options": ["none", "short", "long"], "default": "none" }
  ]
}
```

Each entry is `{ name, scope, type, default?, description?, options? }`:

- **scope** — `project` (evaluated once), `model`, `property` or `route`
  (evaluated per entity). It decides where the value appears:
  `ctx.design.vars.<name>` · `model.vars.<name>` · `property.vars.<name>` ·
  `route.vars.<name>`.
- **type** — `string` · `boolean` · `number` · `enum` (with `options`). The
  user's expression is evaluated then coerced to this type.
- **default** — a literal or Handlebars expression used when the user leaves
  the value empty (globally and per-entity). An unresolved required value
  surfaces as a generation error — never a silent blank.

A **"Discover the variables this template uses"** action in the app scans your
`.jinja` files for `vars.<name>` reads and flags any used-but-not-declared, so
keep the manifest and the templates in sync.

## The context

The template receives the design as the **`ctx`** answer — a flattened,
name-referenced projection defined by `src/shared/design/codegenContext.ts`
and documented by the JSON Schema
[`design-codegen-context.schema.json`](./design-codegen-context.schema.json)
(one file per `contextVersion`; the unit test
`tests/unit/codegenContext.test.ts` enforces that the emitted context
validates against it). Copy the schema into your template repo so its CI
can validate the reference context it generates from.

Highlights:

- cross-references travel **by name** (`property.enum`,
  `property.references.model`, `model.inherits`) — internal ids never
  leak;
- route paths come both group-relative (`path`) and fully composed
  (`fullPath`), `{param}` spelling;
- `route.auth` is the **effective** contract (route override → group →
  design default) — the same one the design server enforces;
- the design intentions a server template can honour are carried:
  `route.cacheSeconds` (→ `Cache-Control` in the official wave-1
  templates), `route.pagination`, `model.volumetry`, `property.pii`,
  `property.searchable`… Real caching strategy (memo, redis…) stays each
  template's own choice — document yours.

## The engine — what runs in the app

Templates stay **genuine Copier templates** (`copier.yml`,
`_subdirectory`, `_templates_suffix: .jinja`, `_exclude`, Jinja in file
CONTENTS and PATH names) — the official repos' CI runs them through
**real Copier**. Inside the app they run in a **Pyodide sandbox**
(MEMFS: the template never touches your machine; the generated tree is
extracted only after the user confirms it) through a Copier-subset
engine (`src/main/services/designCodegen/copierSubsetEngine.ts`):

Supported: questions with literal `default`s (the app supplies answers),
`_subdirectory`, `_templates_suffix`, `_exclude`, sandboxed
`hooks/pre_gen.py` / `hooks/post_gen.py` (exec'd with `ctx` / `answers` /
`output_root`; an escape attempt fails cleanly in MEMFS).
**Refused with a clear error:** `_tasks` and `_migrations` — they demand
a real shell the sandbox deliberately does not have.

## Portability rules (learned the hard way)

Both real Copier and the sandbox pass the context as **plain dicts**, so:

- `example.values` resolves the **dict method**, not your key — spell it
  `example['values']` (same for any key named like a dict method:
  `items`, `keys`, `get`…);
- rendering is **StrictUndefined**: test optional keys with
  `{% if 'enum' in p %}`, never `{% if p.enum %}`;
- the Jinja environment matches Copier's defaults (`trim_blocks`,
  `lstrip_blocks`, `keep_trailing_newline`).

## The official repos

- [`Monsieur-Dev/restorm-template-server-rest-typescript`](https://github.com/Monsieur-Dev/restorm-template-server-rest-typescript) — REST, Express + TypeScript
- [`Monsieur-Dev/restorm-template-server-rest-dotnet`](https://github.com/Monsieur-Dev/restorm-template-server-rest-dotnet) — REST, ASP.NET Core minimal APIs
- [`Monsieur-Dev/restorm-template-server-grpc-typescript`](https://github.com/Monsieur-Dev/restorm-template-server-grpc-typescript) — gRPC, TypeScript
- [`Monsieur-Dev/restorm-template-server-grpc-dotnet`](https://github.com/Monsieur-Dev/restorm-template-server-grpc-dotnet) — gRPC, C# / .NET
- [`Monsieur-Dev/restorm-template-db-postgres`](https://github.com/Monsieur-Dev/restorm-template-db-postgres) — SQL schema, PostgreSQL

Each carries: `copier.yml` + `template/`, the manifest, a `reference/`
answers file built from the petstore reference design, the context
schema copy, an MIT license, and a CI that **generates with real Copier,
builds the result, boots it and smoke-tests a served route** — a broken
official template cannot ship. Fork one of these to start yours; wave-2
stacks (Spring Boot, MongoDB, Axum, SQL Server, FastAPI) follow the same
recipe.

## Safety model (what the app guarantees)

- remote templates arrive as archives via the firewall-bypassed
  provisioning path, SSRF-guarded and size-capped; every archive entry
  is traversal-checked during extraction;
- generation runs in a worker-thread Pyodide (interruptible,
  memory-bounded); the sandbox has no network and no host filesystem;
- extraction validates EVERY path against the confirmed output root
  before the first byte lands (no partial trees on refusal) — see
  `tests/unit/designCodegenExtract.test.ts`;
- an invalid design cannot generate (same gate as serving); generation
  is part of `DESIGN_RUN_CAPABILITY` (visible-but-locked in Community).
