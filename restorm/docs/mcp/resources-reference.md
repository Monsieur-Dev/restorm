# MCP resources reference

Resources are MCP's read-once-at-the-top primitive: an MCP client can pull a snapshot of project state without learning the tool surface. They're a good fit for "the AI just joined the conversation, what's currently open?" prompts.

All Restorm resources return JSON text (`mimeType: application/json`). Secrets are stripped on the way out via the same `CollectionStore.serialize*` paths the tools use, so `restorm://request/{id}` returns the same masked shape `get_request` does.

Source: [`restorm/src/main/mcp/resources.ts`](../../src/main/mcp/resources.ts).

## `restorm://project`

Open project metadata.

```jsonc
{
  "path": "/home/me/work/petstore.restorm",   // null when no project open
  "name": "petstore",                         // null when no project open
  "isDirty": false,
  "fileFormatVersion": 1,
  "collectionCount": 1
}
```

Useful for: "is a project open at all?", "what file is the user working on?", "is there unsaved work I should warn about before I run something destructive?".

## `restorm://tree`

Full hierarchical id + name tree of the project. Lightweight — no request bodies, no environment variable values. Match a name to an id, then call `get_request(id)` for the full payload.

```jsonc
[
  {
    "id": "0e3b8264-...",
    "name": "Petstore",
    "kind": "env-folder",
    "children": [
      {
        "id": "3edf1107-...",
        "name": "pet",
        "kind": "folder",
        "children": [
          { "id": "1bb7817d-...", "name": "Find pet by ID", "kind": "request", "protocol": "http" }
        ]
      }
    ]
  }
]
```

The exact shape lives in `restorm/src/main/mcp/tree.ts` — this snippet is illustrative.

## `restorm://active-tab`

Mirrors the `get_current_tab` tool. Provided as a resource too because some clients distinguish "tools that take time" from "resources that can be read freely" and gate them differently.

```jsonc
{
  "tabId": "tab-1",
  "itemId": "1bb7817d-...",
  "kind": "request"           // null when no item is open
}
```

## `restorm://request/{id}`

Templated resource — the SDK's resource-template machinery matches `restorm://request/<actual-id>` and routes the parsed `id` into the handler. Returns the same payload as `get_request(id)`:

```jsonc
{
  "id": "1bb7817d-...",
  "name": "Find pet by ID",
  "type": "http",
  "method": "GET",
  "url": "{{baseUrl}}/pet/{petId}",
  "pathParams": [{ "key": "petId", "value": "0", "enabled": true }],
  "headers": [...],
  "body": null,
  "tags": [],
  "notes": "",
  // … all protocol-specific fields
}
```

Secret fields like API keys / passwords come back as `{ "type": "password" }` — plaintext is stripped before the handler returns.

## When to use a resource vs. a tool

- Reach for a resource when the AI just wants to "see" something (project metadata, the tree, the current tab). Resources are zero-arg by design and feel cheap to the client.
- Reach for a tool (`list_folders`, `list_requests`, `get_request`, `search`, …) when the AI needs to filter, paginate, or pass parameters. Tools are the right contract there.

The two surfaces share their underlying readers, so you'll never see a resource say something different from the equivalent tool — and vice versa.
