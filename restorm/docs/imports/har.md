# HAR (HTTP Archive) import

Restorm imports a HAR (`.har`) file — the network-capture export every major
browser's devtools produce (Chrome, Firefox, Safari, Edge) — turning every
recorded network call into a replayable request. This is the fastest way to
turn "I watched my web app talk to its API" into a working request tree: open
devtools → Network tab → capture the flow → *Save all as HAR* → import.

## How to import

*File → Import* and pick / drag-drop the `.har` file, or paste its raw JSON.
No format needs to be picked manually — `HarImportService.canImport` sniffs
`log.version` (falling back to the `.har` extension when a producer omits it).

## What gets imported

* One HTTP request per `log.entries[]` item — method, URL (query string
  included verbatim), query params (also broken out as editable rows),
  headers, cookies, and the request body.
* **Cookies** — HAR lists `cookies[]` separately from `headers[]` even though
  browsers already send a literal `Cookie:` header; Restorm merges them into
  a single canonical `Cookie` header (no duplicate).
* **Bodies** — `multipart/form-data` and `application/x-www-form-urlencoded`
  import as typed field rows (from `postData.params[]`, falling back to
  parsing the raw urlencoded text when a producer omits `params`); everything
  else (JSON, XML, plain text) imports as raw text.
* **Grouping** — entries are grouped into a folder per HAR page (`pageref`),
  named after the matching `log.pages[].title`. An archive with a single page
  (or no page information at all — some HAR producers omit `pages`) imports
  flat under the root folder instead of adding a redundant lone sub-folder.

## What's intentionally dropped

* HTTP/2 pseudo-headers (`:authority`, `:method`, `:path`, `:scheme`) — not
  real wire headers, and re-sending them verbatim would just error.
* `content-length` — stale the moment the body is edited; Restorm computes it
  at send time.

## Known limitations

* **No dedupe.** A HAR capture of a polling endpoint or a page reload
  produces one request per call, including exact repeats (same method +
  URL) — v1 imports everything as-is rather than collapsing repeats into one
  request with multiple history entries.
* **No "refresh from source."** Unlike Swagger/OpenAPI/GraphQL/Postman/etc.,
  a HAR file has no live URL to re-fetch and diff against — it's a one-off
  browser capture, the same way a pasted `curl` command is. Re-importing the
  same file adds a second, independent copy of the requests rather than
  merging into the existing folder.
* **No response replay yet.** A HAR is a recording of request *and* response
  pairs, so replaying the captured responses into the imported requests'
  response-history panel is the natural next step — every entry still
  imports as a full, working request, just without its captured response
  attached. Seeding the response-history panel needs the imported request's
  real, final id, but every current import path either re-ids items before
  they land in the collection (the *File → Import* menu, to avoid clashing
  with existing items) or has no local-file support (the only MCP import
  tool is URL-only). This is generic import infrastructure — not specific to
  HAR — so it's tracked as a dedicated follow-up rather than solved here.
