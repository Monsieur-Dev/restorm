# WADL import

WADL (Web Application Description Language) is the old Sun / Oracle XML
format for describing REST services — still emitted by some legacy JAX-RS
services, largely dead everywhere else. Restorm parses it with
`fast-xml-parser` and walks the resulting tree; unlike WSDL/EDMX (flat
operation lists), a WADL document is a genuine tree of arbitrarily nested
`<resource>` elements, so this importer cannot reuse the lazy-regex tag
matcher the WSDL / OData importers use.

## How to import

* **File** — drag and drop a `.wadl` file, or pick via *File → Open*.
* **Paste** — *File → Import* and paste the raw XML.

Detection: a `.wadl` file extension, or XML content containing the WADL
namespace (`http://wadl.dev.java.net/2009/02`). WSDL and other XML formats
never match this sniff.

## Mapping

| WADL concept | Restorm concept |
| --- | --- |
| `<resources base="...">` | Environment `baseUrl` variable |
| `<resource path="...">` | A `Folder`, one per `<resource>` element (nested resources → nested folders) |
| `<method name="GET" id="getUser">` | An `HTTPRequest` under its resource's folder; the method's `id` becomes the request name, falling back to `"<VERB> <path>"` |
| `<param style="template">` | `request.pathParams` — inherited from every ancestor `<resource>` down to the method that uses it |
| `<param style="query">` | `request.params` |
| `<param style="header">` | `request.headers` |
| `<request><representation mediaType="...">` | `Content-Type` header + a body stub for `POST`/`PUT`/`PATCH` |
| `<response><representation mediaType="...">` | `Accept` header |
| `<grammars>` inline `<element>`/`<complexType>` | `apiDocumentation.models`, one level of properties deep |

WADL's `{var}` path templates use the same syntax Restorm's Handlebars
resolver expects, so they are rewritten to `{{var}}` at import time — no
"declared vs. literal" ambiguity to resolve, since every `{var}` occurring in
a WADL path is by definition a template parameter.

## Grammars / XSD

Only the trivial case is supported: an inline `<xs:schema>` under
`<grammars>` whose `<xs:element>` / `<xs:complexType>` declares a flat
`<xs:sequence>` of primitive-typed properties. Each becomes a model in
`apiDocumentation.models`.

**Not resolved:**

* External schema references — `<include href="...">` at the `<grammars>`
  level, or `<import schemaLocation="...">` inside a `<schema>`. Their
  locations are collected and surfaced as a note in the generated
  `apiDocumentation.api.description` ("External XSD schema(s) referenced
  but not resolved: ...") — Restorm never fetches or parses them.
* Nested `<complexType>` (a property whose type is itself a complex type
  defined elsewhere) — only the immediate, flat property list is read.
* `resource_type` indirection (`<resource type="#commonMethods">` reusing a
  shared `<resource_type>` block) — not supported; the resource's own
  `<method>` elements are read, nothing more.

## Where the code lives

* Service: `src/main/services/import/WadlImportService.ts` (parsing,
  folder/request materialisation, and the `ApiDocumentation` transform all
  live in this one file — there is no multi-step transformer pipeline for
  this format).
* Detection / dispatch: `src/main/services/import/registry.ts` via
  `src/main/services/import/providers.ts`.
* Fixtures: `tests/unit/fixtures/wadl/`.
