# OYO-73: Add Testing Endpoints

This ticket adds Docker-based testing endpoints for multiple protocols that Restorm will support.

## Supported Protocols

| Protocol | Image | Container Name | Ports |
|----------|-------|----------------|-------|
| REST/HTTP | `swaggerapi/petstore` | restorm-petstore | 8080 |
| GraphQL | Custom Apollo Server | restorm-graphql | 4000 |
| MQTT | `eclipse-mosquitto:2` | restorm-mqtt | 1883, 9001 |
| SOAP | `castlemock/castlemock` | restorm-soap | 8090 |
| gRPC | `moul/grpcbin` | restorm-grpc | 9000, 9001 |
| Socket.IO | Custom Node.js server | restorm-socketio | 3001 |

## Usage

### Start all services

```bash
cd restorm/tests/docker
docker-compose up -d
```

### Stop all services

```bash
docker-compose down
```

## Endpoint Details

### REST/HTTP - Petstore (port 8080)

OpenAPI 3.0 compliant REST API.

- Swagger UI: http://localhost:8080
- API Base: http://localhost:8080/api/v3

### GraphQL - Apollo Server (port 4000)

GraphQL endpoint for testing queries and mutations.

- Endpoint: http://localhost:4000
- GraphQL Sandbox: http://localhost:4000 (interactive playground)
- Example query:

```graphql
{
  users {
    id
    name
    email
    posts {
      title
    }
  }
}
```

Available operations:
- Queries: `users`, `user(id)`, `posts`, `post(id)`, `echo(message)`
- Mutations: `createUser`, `createPost`, `deleteUser`, `deletePost`

### MQTT - Mosquitto (ports 1883, 9001)

MQTT broker for pub/sub testing.

- MQTT: `mqtt://localhost:1883`
- WebSocket: `ws://localhost:9001`
- Anonymous connections allowed (testing only)

### SOAP - Castle Mock (port 8090)

SOAP/WSDL mock server with web UI.

- Web UI: http://localhost:8090/castlemock
- Default credentials: `admin/admin`
- Create mock SOAP services through the UI

### gRPC - gRPCbin (ports 9000, 9001)

gRPC echo server for testing.

- gRPC: `localhost:9000`
- gRPC-Web: `localhost:9001`
- Reflection enabled for service discovery

### Socket.IO (port 3001)

Custom Socket.IO test server with the following events:

| Event | Description | Response |
|-------|-------------|----------|
| `echo` | Echo data back | `echo` with same data |
| `ping` | Ping request | `pong` with timestamp |
| `broadcast` | Send to all clients | `broadcast` to all |
| `join-room` | Join a room | `joined` confirmation |
| `leave-room` | Leave a room | `left` confirmation |
| `room-message` | Send to room | `room-message` to room members |

## Files Structure

```
restorm/tests/docker/
├── docker-compose.yml      # Main compose file
├── mosquitto.conf          # MQTT broker configuration
├── graphql-server/         # GraphQL test server
│   ├── package.json
│   └── server.js
└── socketio-server/        # Socket.IO test server
    ├── package.json
    └── server.js
```
