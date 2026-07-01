# Apache Thrift (`.thrift`) import

Apache Thrift is an RPC IDL (Facebook / Twitter legacy, still present in some
Hadoop / data-plane systems). Restorm imports `.thrift` files to let you
**browse** a service's shape — services, methods, structs, enums — but v1
**does not execute Thrift RPCs**.

## Why documentation-only

Thrift services speak their own binary wire protocol, not HTTP. There is no
route to turn an `rpc` method into today's `HTTPRequest` / `GrpcRequest` /
`SoapRequest` shapes without a dedicated Thrift execution service (its own
protocol handler + scenario node), which doesn't exist yet. Importing a
`.thrift` file therefore produces:

* One folder per `service`, empty of executable children.
* A full `apiDocumentation` tree (models, groups, operations) so every method
  — its arguments, return type, and referenced structs — is browsable in the
  Docs tab, exactly like an OpenAPI or gRPC import.

A follow-up ticket can wire up execution if there's demand.

## How to import

* **File** — drag and drop a `.thrift` file, or pick it via *File → Open*.
* **Paste** — *File → Import* and paste raw Thrift IDL text.

Detection is content-based: a `.thrift` file extension, or content starting
with a `namespace` or `service` declaration, routes to this importer.

## Mapping

| Thrift concept | Restorm concept |
| --- | --- |
| `namespace` | Root environment folder name (first declared namespace wins) |
| `service { ... }` | A documentation-only sub-folder (no items) + an `apiDocumentation` group |
| `service` method | An `apiDocumentation.operations[]` entry, flagged `extra.documentationOnly: true` — arguments become `parameters`, the return type is carried on `extra.returnType`, `oneway` methods are flagged `extra.oneway: true` |
| `struct` / `union` / `exception` | `apiDocumentation.models` (fields → properties, `optional` fields are non-required, everything else defaults to required) |
| `enum` | `EnumDefinition` on the root environment folder (member names as the value list; no `matchingRules` since there is no request to bind them to) |
| `typedef` | Resolved inline to its underlying type wherever it's referenced — a typedef carries no separate entry in the docs |
| `include "other.thrift"` | Resolved relative to the importing file's directory (same-directory only) and merged in before parsing; an unresolvable include logs a warning and is skipped rather than failing the import |
| `service ... extends Other` | The extending service inherits `Other`'s methods (a method it redeclares itself wins) |

## Known limitations

* **No execution** — every operation is documentation-only in v1.
* **Cross-directory includes** are not resolved — only a sibling file in the
  same directory as the imported `.thrift` file is picked up. Pasted content
  has no directory context, so its includes always log a warning and are
  skipped.
* **Cross-include type references** (`common.PetId` where `PetId` is a
  `typedef` declared inside the included file) are not resolved to their
  underlying primitive — the qualified name is kept as-is in the docs.
* **`throws` clauses** are parsed but not surfaced on `apiDocumentation` —
  Thrift exceptions don't map onto the HTTP-status-shaped `responses` field.

## Where the code lives

* Service: `src/main/services/import/ThriftImportService.ts`.
* Transformer: `src/main/services/import/transformers/thriftToApiDocumentation.ts`.
* Detection / dispatch: `src/main/services/import/ImportManager.ts`.
* Fixtures: `tests/unit/fixtures/thrift/`.
