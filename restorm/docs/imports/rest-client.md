# REST Client (`.http` / `.rest`) import

Restorm imports the plain-text request files used by the VSCode extension
[REST Client](https://marketplace.visualstudio.com/items?itemName=humao.rest-client)
(`Humao.rest-client`) — the entire user base of that extension gets a
one-file import into a Restorm collection.

## Format

```
@baseUrl = https://api.example.com
@token = abc123

### Get users
GET {{baseUrl}}/users
Authorization: Bearer {{token}}

### Create user
# @name createUser
POST {{baseUrl}}/users
Content-Type: application/json

{ "name": "Alice" }
```

* Requests are separated by a `###` line. A single-request file needs no
  separator at all.
* Each block starts with `METHOD URL` (an optional trailing `HTTP/1.1` is
  ignored), followed by `Key: Value` headers, a blank line, and an optional
  raw body (JSON, XML, form-urlencoded, plain text — carried through
  verbatim).
* `{{var}}` placeholders are already Handlebars syntax, so they pass through
  untouched and resolve exactly like any other Restorm expression.
* `@name = value` declarations before the first `###` become variables in
  the imported folder's `Default` environment.
* A `# @name <id>` comment inside a block names that request `<id>`; without
  one, the text on the `###` line is used, falling back to `METHOD /path`.

## How to import

* **File** — *File → Import*, pick a `.http` or `.rest` file. The extension
  alone is enough for auto-detection.
* **Paste** — paste the content directly; auto-detection then looks for a
  leading `METHOD https://...` line (e.g. `GET https://...`), so a pasted
  snippet that opens with `@var = ...` declarations needs the file picker
  instead.

## Known limitations

* REST Client's scripting directives (`# @prompt` for interactive values,
  `# @note`) are not evaluated — comments are skipped, not translated into
  Restorm behaviour.
* `curl` blocks embedded in a `.http` file (a REST Client extra) are not
  parsed by this importer.
* The body is always imported as raw text — Restorm does not currently
  split a `multipart/form-data` or `application/x-www-form-urlencoded` body
  into individual fields for this format.
