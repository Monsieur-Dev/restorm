# OYO-74: Add Import Services for gRPC, GraphQL, SOAP and WebSockets

This ticket adds support for importing and executing requests for multiple protocols beyond HTTP/REST.

## Supported Protocols

| Protocol | Import Service | Request Service | Tab View |
|----------|---------------|-----------------|----------|
| HTTP/REST | SwaggerImportService | HTTPRequestService | HTTPRequestTabView |
| GraphQL | GraphQLImportService | GraphQLRequestService | GraphQLRequestTabView |
| gRPC | GrpcImportService | GrpcRequestService | GrpcRequestTabView |
| SOAP | SoapImportService | SoapRequestService | SoapRequestTabView |
| WebSocket/Socket.IO/MQTT | AsyncAPIImportService | WebSocketRequestService | WebSocketRequestTabView |

## New Types

Added to `collections.ts`:

- `GraphQLRequest` - GraphQL query/mutation/subscription
- `GrpcRequest` - gRPC unary/streaming calls
- `SoapRequest` - SOAP web service operations
- `WebSocketRequest` - WebSocket/Socket.IO/MQTT connections

## Import Services

Each import service parses a specification format and creates a folder structure:

- **GraphQLImportService**: Parses `.graphql` SDL schema files
- **GrpcImportService**: Parses `.proto` Protocol Buffer files
- **SoapImportService**: Parses `.wsdl` WSDL XML files
- **AsyncAPIImportService**: Parses AsyncAPI `.yaml/.json` specifications

## Request Services

Each request service handles executing requests for its protocol:

- **GraphQLRequestService**: HTTP POST to GraphQL endpoint
- **GrpcRequestService**: gRPC calls (requires gRPC-Web proxy)
- **SoapRequestService**: HTTP POST with SOAP envelope
- **WebSocketRequestService**: WebSocket/Socket.IO connections

## Tab Views

Each tab view provides a protocol-specific UI:

- Query/variables editor for GraphQL
- Message JSON editor for gRPC
- XML body editor for SOAP
- Message + event/topic for WebSocket

## Test Files

Test specification files are automatically imported at startup:

- `swagger-petstore.json` - REST API
- `graphql-docker.graphql` / `graphql-petstore.graphql` - GraphQL
- `grpc-docker.proto` / `grpc-petstore.proto` - gRPC
- `soap-docker.wsdl` / `soap-petstore.wsdl` - SOAP
- `asyncapi-docker.yaml` / `asyncapi-petstore.yaml` - AsyncAPI

## Limitations

- **gRPC**: Requires a gRPC-Web proxy (like Envoy) or native Node.js implementation
- **WebSocket**: Basic browser WebSocket support; Socket.IO/MQTT need additional libraries
- **SOAP**: Castle Mock server needs manual configuration via web UI
