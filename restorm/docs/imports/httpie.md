# HTTPie import

Restorm imports two distinct HTTPie export shapes — the desktop app's
collection export, and the CLI's session file — through a single
`HttpieImportService.ts`.

| Shape | Detector | Result |
| --- | --- | --- |
| HTTPie Desktop collection | top-level `app: "HTTPie Desktop"` + a `collections` array | Folder tree of `HTTPRequest`s |
| HTTPie CLI session file | top-level `__meta__` + `headers`, with no `app`/`collections` | Environment folder carrying the session's persistent state |

cURL-style HTTPie one-liners (`http GET example.com/pets`) are **not** covered
here — paste them into the import modal and the existing cURL importer's
shorthand parser (`parseCurlCommand`) handles them, since HTTPie's CLI syntax
is a drop-in superset of that flow for the fields Restorm imports.

## Desktop collection

A collection export is a tree of named folders and requests:

```json
{
  "app": "HTTPie Desktop",
  "version": "2024.1.0",
  "collections": [
    {
      "name": "Petstore",
      "children": [
        { "type": "request", "name": "List pets", "method": "GET", "url": "…" }
      ]
    }
  ]
}
```

A single top-level collection becomes the root environment folder, named
after the collection. Multiple top-level collections (an "export everything"
dump) land under a generic `HTTPie Import` root, one sub-folder per
collection.

| HTTPie Desktop concept | Restorm concept |
| --- | --- |
| `collections[].name` | Root environment folder name (single collection) or sub-folder name (multiple) |
| Folder nodes (`children` without `type: "request"`) | `Folder` |
| Request nodes (`type: "request"`) | `HTTPRequest` |
| `headers` | `request.headers` |
| `params` | `request.params` (query string) |
| `body.data` (object, `contentType` containing `form-urlencoded`) | `request.body` as `x-www-form-urlencoded` |
| `body.data` (object, other content types) | `request.body` as `text` (pretty-printed JSON) |
| `body.data` (string) | `request.body` as `text`, verbatim |

## CLI session file

A session file (`~/.httpie/sessions/<host>/<name>.json`) has no requests of
its own — it's a snapshot of state HTTPie replays on every call made with
`--session`:

```json
{
  "__version__": "3.2.2",
  "__meta__": { "about": "HTTPie session file" },
  "headers": { "Accept": "application/json" },
  "auth": { "type": "basic", "username": "demo", "password": "…" },
  "cookies": {}
}
```

It imports as an **empty** environment folder — no requests, just a `Default`
environment holding the persistent state as variables so the user can wire
them into requests they build (or import separately) afterwards:

| Session field | Environment variable |
| --- | --- |
| `headers.<name>` | `<name>` (verbatim header name as the variable key) |
| `auth.type` | `authType` |
| `auth.username` | `authUsername` (only when present) |
| `auth.password` | `authPassword` (only when present) |

**Known limitation:** HTTPie CLI sessions don't carry their target host in
the file — it's implied by the `<host>` directory segment in the on-disk
path, which the generic content-based importer never sees. The `baseUrl`
variable is only populated when the caller passes one explicitly
(`{ baseUrl: '...' }`); otherwise import the session, then fill in `baseUrl`
by hand.

## Shorthand mapping (documentation only)

Restorm's importer never parses HTTPie's CLI shorthand syntax directly — both
supported export shapes are already structured JSON. The table below is a
reference for users translating a remembered `http` command into Restorm's
fields:

| HTTPie CLI shorthand | Meaning | Restorm field |
| --- | --- | --- |
| `name==value` | Query string parameter | `request.params` |
| `name:value` | Header | `request.headers` |
| `name=value` | JSON / form body field | `request.body` (`text` for JSON, `x-www-form-urlencoded` for form) |
| `name:=value` | Raw JSON body field (non-string value) | `request.body` (`text`) |
| `name@file` | File upload field | Not imported — attach the file manually after import |

## How to import

Same three entry paths as every other importer: drag-and-drop a file, *File →
Import* and paste a URL, or paste raw JSON. Detection is auto: a JSON root
carrying `app: "HTTPie Desktop"` + `collections` routes to the collection
importer; a JSON root carrying `__meta__` + `headers` with neither `app` nor
`collections` routes to the session importer.

## Where the code lives

* Service: `src/main/services/import/HttpieImportService.ts`.
* Detection / dispatch: `src/main/services/import/ImportManager.ts`.
* Fixtures: `tests/unit/fixtures/httpie/`.
