# Paw import

Restorm imports [Paw](https://paw.cloud) (now RapidAPI for Mac) collections
exported as **JSON**. The native `.paw` file is a binary bundle in recent
versions of the app — export to JSON from Paw first (*File → Export → JSON*),
then paste the file / its content into Restorm's import dialog.

## Supported input

* Paw's JSON export: a top-level object with `requests` (a dict of requests
  keyed by uuid), `requestGroups` (folders, same dict shape), and
  `environments`.
* Detected by a `pawVersion` field, a `$schema` referencing Paw, or the
  `requests` + `requestGroups` dict shape itself (Postman's `item[]` tree and
  Insomnia's `resources[]` list don't match this shape, so detection stays
  unambiguous).

## What gets imported

| Paw concept | Restorm concept |
| --- | --- |
| `requestGroups` | Nested `Folder`s (hierarchy preserved via `parentId`) |
| `requests` | `HTTPRequest`s (method, URL, headers, query params, body, description) |
| `environments` | `Environment`s on the imported root folder |

The native `.paw` scripting extensions (JS pre-request / post-response
scripts) have no restorm equivalent and are not imported.

## Dynamic values

Paw's "dynamic values" are computed field values — the JSON export represents
them as `{ "$class": "com.luckymarmot.DynamicValue", "type": "..." }` objects
instead of a plain string. Restorm maps the ones with a Handlebars
equivalent and replaces the rest with a placeholder:

| Paw dynamic value | Restorm mapping |
| --- | --- |
| `RandomStringDynamicValue` | `{{$randomAlphaNumeric}}` |
| `TimestampDynamicValue` | `{{$timestamp}}` |
| `UUIDDynamicValue` | `{{$guid}}` |
| Anything else (`ResponseBodyDynamicValue`, `CookieJarDynamicValue`, environment-reference values, …) | Literal `[[paw:unsupported-dynamic-value]]` placeholder, with a note appended to the affected field's description explaining which dynamic value it replaced |

Unmapped values are never silently dropped — the placeholder plus the note
make it obvious in the imported request which field needs manual attention.
