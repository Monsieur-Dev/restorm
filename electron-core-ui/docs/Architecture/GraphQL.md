# GraphQL Integration

Auto-generated GraphQL schema from decorated TypeScript classes with real-time subscriptions.

## Schema Generator

The `GraphQLSchemaGenerator` reads decorator metadata to generate type definitions.

```typescript
import { GraphQLSchemaGenerator } from 'electron-core-ui/main'

const generator = new GraphQLSchemaGenerator()

// Register decorated classes
generator.registerType(Document)
generator.registerType(Folder)
generator.registerEnum('RequestMethod', ['GET', 'POST', 'PUT', 'DELETE'])

// Generate schema
const typeDefs = generator.generateTypeDefs()
```

## Subscriptions

Real-time updates via Server-Sent Events (SSE).

### Server Setup (Main Process)

```typescript
import { createPubSub } from 'electron-core-ui/main'

const pubsub = createPubSub()

// Publish events
pubsub.publish('DOCUMENT_UPDATED', { documentUpdated: doc })

// Resolver
const resolvers = {
  Subscription: {
    documentUpdated: {
      subscribe: () => pubsub.subscribe('DOCUMENT_UPDATED')
    }
  }
}
```

### Client Setup (Renderer)

```typescript
import { GraphQLClient } from 'electron-core-ui/renderer'

const client = new GraphQLClient('http://localhost:4000/graphql')

// Subscribe to updates
client.subscribe(
  `subscription { documentUpdated { id name } }`,
  (data) => console.log('Updated:', data)
)
```

## Data Flow

```
Store Mutation → PubSub.publish() → GraphQL Subscription → Renderer → UI Update
```

## SSE Transport

Uses `graphql-sse` for subscriptions over HTTP:

- No WebSocket required
- Works through proxies
- Automatic reconnection

