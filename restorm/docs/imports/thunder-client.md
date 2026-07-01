# Thunder Client import

Restorm imports Thunder Client collection exports (the VS Code REST client
extension's own JSON format) and turns them into a folder of requests, one
sub-folder per Thunder Client folder.

## Supported input

A Thunder Client collection export — typically a `thunder-collection_*.json`
file, shaped like:

```json
{
  "clientName": "Thunder Client",
  "collectionName": "My Collection",
  "version": "1.1",
  "folders": [{ "id": "…", "name": "…", "containerId": "" }],
  "requests": [{ "id": "…", "name": "…", "url": "…", "method": "GET", "containerId": "" }]
}
```

`canImport` recognises a top-level `clientName` (or `client`) equal to
`"Thunder Client"`. As a tiebreaker against Postman collections — which share
the same JSON-object family — a document with both a `folders` and a
`requests` array and no `info.schema` is also accepted.

The importer lives in `src/main/services/import/ThunderClientImportService.ts`.

## Field mapping

| Thunder Client | Restorm |
| --- | --- |
| `requests[].method` / `.url` | `HTTPRequest.method` / `.url` |
| `requests[].headers[]` | `HTTPRequest.headers` (disabled rows via `isDisabled` are dropped) |
| `requests[].params[]` | Split into `HTTPRequest.params` (query) and `.pathParams`, using each row's `isPath` flag |
| `requests[].body` (`json` / `xml`) | A `text` body, raw content preserved verbatim |
| `requests[].body` (`formdata`) | A `form-data` body |
| `requests[].body` (`form-encoded`) | An `x-www-form-urlencoded` body |
| `requests[].body` (`graphql`) | A dedicated `GraphQLRequest` (query + variables), not an HTTP body |
| `requests[].body` (`binary`) | A `file` body |
| `requests[].body` (`none`) | No body |
| `requests[].docs` | `documentation` on the generated request |
| `requests[].tests[]` | `notes` on the generated request — read-only text, never executed |
| `folders[]` + `requests[].containerId` | Folder hierarchy, rebuilt by matching each request/folder's `containerId` to a folder's `id` |
| `{{variable}}` | Passed straight through — already Handlebars-compatible |

## How to import

*File → Import*, then pick or drag-and-drop the exported collection JSON, or
paste its content. The format is auto-detected; there is no format picker.

## Known limitations

* Thunder Client's own environment export (a separate file) isn't read — only
  a caller-supplied base URL seeds the generated environment. Re-attach your
  variables after importing, or add them from an existing environment.
* Test assertions (`requests[].tests[]`) are carried over as read-only notes,
  never executed. Thunder Client's own pre-request/test scripting is out of
  scope.
