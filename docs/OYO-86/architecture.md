# OYO-86 Architecture Documentation

## Overview

OYO-86 implements a decorator-based architecture for Restorm, enabling:
- Automatic GraphQL schema generation from TypeScript decorators
- Flexible persistence (single file or folder structure)
- Real-time UI updates via GraphQL subscriptions
- Searchable document indexing

## Key Components

### 1. Decorated Models (`restorm/src/shared/models/`)

TypeScript classes with decorators that define:
- Serialization behavior (`@NonSerialised`)
- Search indexing (`@searchable`)
- Change tracking (`@trackable`)
- File structure (`@separateFiles`, `@separateFolders`, `@fileNaming`)

**Key Classes:**
- `BaseDocument` - Base class for all trackable, searchable entities
- `KeyValue` - Headers, params, environment variables
- `Environment` - Environment configurations with variables
- `Folder` / `EnvironmentFolder` - Collection structure
- Request types: `HTTPRequest`, `GraphQLRequest`, `GrpcRequest`, `SoapRequest`, `WebSocketRequest`

### 2. GraphQL Schema Generator (`electron-core-ui/src/main/services/GraphQLSchemaGenerator.ts`)

Dynamically generates GraphQL schema from decorated classes:
- Reads decorator metadata at runtime
- Creates type definitions (`typeDefs`)
- Generates resolver stubs

### 3. Collection Store (`restorm/src/main/services/CollectionStore.ts`)

Main process store managing:
- In-memory collection state
- CRUD operations for folders, requests, environments
- PubSub integration for GraphQL subscriptions
- Event emission for UI synchronization

### 4. GraphQL Subscriptions

Real-time updates via:
- PubSub topics for create/update/delete events
- SSE-based subscriptions (`graphql-sse`)
- Renderer subscribes to changes, store emits on mutations

### 5. Persistence Service (`electron-core-ui/src/main/services/PersistenceService.ts`)

Handles file operations:
- Single file mode (JSON, YAML, JSON5)
- Folder mode with decorator-based structure
- Respects `@NonSerialised`, `@separateFolders`, `@fileNaming`

### 6. Dirty State Management (`restorm/src/renderer/src/hooks/useDirtyState.ts`)

Per-tab dirty state tracking for folder mode:
- Checksum-based change detection
- Independent save state per document
- Enables incremental saves

## Data Flow

```
User Action → CollectionStore → PubSub → GraphQL Subscription → Renderer Store → UI
                    ↓
            EventBusService → SearchIndexService
```

## File Structure (Folder Mode)

```
collection/
├── environments/
│   └── 01 - Production.json
├── 01 - Users/
│   ├── 01 - GET - List Users.json
│   └── 02 - POST - Create User.json
└── 02 - Products/
    └── 01 - GET - List Products.json
```

## Key Decorators

| Decorator | Purpose |
|-----------|---------|
| `@trackable()` | Enables change tracking |
| `@searchable()` | Indexes document for search |
| `@NonSerialised()` | Excludes field from serialization |
| `@separateFolders()` | Creates subfolder in folder mode |
| `@fileNaming({ pattern })` | Custom file naming pattern |

