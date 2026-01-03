# Architecture Overview

electron-core-ui provides a decorator-based architecture for Electron applications with:

- **GraphQL Integration** - Auto-generated schema from TypeScript decorators
- **Persistence Layer** - Single file or folder-based storage
- **Event System** - Real-time updates via PubSub and subscriptions
- **Search Indexing** - Automatic document indexing for search

## Documentation

| Topic | Description |
|-------|-------------|
| [Decorators](./Decorators.md) | TypeScript decorators for models |
| [GraphQL](./GraphQL.md) | Schema generation and subscriptions |
| [Persistence](./Persistence.md) | File and folder serialization |
| [Events](./Events.md) | Event bus and PubSub system |

