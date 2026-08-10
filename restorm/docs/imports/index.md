# Imports — index

Restorm ingests external API specifications via the importer pipeline in
`src/main/services/import/`. Each format ships its own service + transformer
pair plus a content sniffer that the central `ImportManager` consults to
route incoming files / URLs / pasted content to the right adapter.

| Format | Doc |
| --- | --- |
| Restorm project (`.restorm`, merge into the open project) | [`restorm.md`](./restorm.md) |
| OpenAPI 2.0 / 3.0 / 3.1 (Swagger) | [`openapi.md`](./openapi.md) |
| OData v2 / v3 / v4 (EDMX + JSON-CSDL) | [`odata.md`](./odata.md) |
| HAR (HTTP Archive) | [`har.md`](./har.md) |
| REST Client (`.http` / `.rest`) | [`rest-client.md`](./rest-client.md) |
| Thunder Client collections | [`thunder-client.md`](./thunder-client.md) |
| Paw (JSON export) | [`paw.md`](./paw.md) |
| HTTPie (Desktop collections + CLI sessions) | [`httpie.md`](./httpie.md) |
| Smithy (AWS API modeling — JSON AST + `.smithy` IDL) | [`smithy.md`](./smithy.md) |
| RAML 1.0 / 0.8 | [`raml.md`](./raml.md) |
| WADL (Web Application Description Language) | [`wadl.md`](./wadl.md) |
| API Blueprint (`.apib`) | [`api-blueprint.md`](./api-blueprint.md) |
| Apache Thrift IDL (`.thrift`, documentation only) | [`thrift.md`](./thrift.md) |
| TypeSpec (`.tsp`, via `tsp compile` → OpenAPI) | [`typespec.md`](./typespec.md) |

For periodic re-checks of an already-imported spec (Swagger,
OpenAPI 3, GraphQL, Postman, Insomnia, Bruno, AsyncAPI, gRPC, SOAP,
OData) and the operator-facing UX, see
[`api-update-checks.md`](./api-update-checks.md). For the
`ImportAdapter` interface every format implements to participate in
the idempotent refresh pipeline, see
[`adapter-interface.md`](./adapter-interface.md).

For a tour of the overall import pipeline (sniffing, dispatch, idempotent
re-import, enum reconciliation, fixtures, E2E coverage), see the playbook at
[`../contributing/adding-an-import.md`](../contributing/adding-an-import.md).
