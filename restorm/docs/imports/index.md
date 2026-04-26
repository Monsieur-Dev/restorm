# Imports — index

Restorm ingests external API specifications via the importer pipeline in
`src/main/services/import/`. Each format ships its own service + transformer
pair plus a content sniffer that the central `ImportManager` consults to
route incoming files / URLs / pasted content to the right adapter.

| Format | Doc |
| --- | --- |
| OpenAPI 2.0 / 3.0 / 3.1 (Swagger) | [`openapi.md`](./openapi.md) |

For a tour of the overall import pipeline (sniffing, dispatch, idempotent
re-import, enum reconciliation, fixtures, E2E coverage), see the playbook at
[`../contributing/adding-an-import.md`](../contributing/adding-an-import.md).
