# Event System

Event-driven architecture for decoupled communication.

## EventBusService

Synchronous pub/sub for internal events.

```typescript
import { eventBusService } from 'electron-core-ui/main'

// Subscribe
const unsubscribe = eventBusService.on('document:updated', (payload) => {
  console.log('Document updated:', payload)
})

// Emit
eventBusService.emit('document:updated', { id: '123', name: 'New Name' })

// Cleanup
unsubscribe()
```

## Document Events

Standard events for CRUD operations:

| Event | Payload |
|-------|---------|
| `document:created` | `{ id, type, document }` |
| `document:updated` | `{ id, type, changes }` |
| `document:deleted` | `{ id, type }` |

## GraphQL PubSub

Async pub/sub for GraphQL subscriptions.

```typescript
import { createPubSub } from 'electron-core-ui/main'

const pubsub = createPubSub()

// Publish (async iterator)
pubsub.publish('TOPIC', { data })

// Subscribe (returns async iterator)
const iterator = pubsub.subscribe('TOPIC')
```

## Integration Pattern

Combine EventBus and PubSub for full-stack reactivity:

```typescript
// Store emits on mutation
class Store {
  updateDocument(id: string, changes: object) {
    // Update state
    this.documents.set(id, { ...doc, ...changes })
    
    // Emit for local listeners (search index, etc.)
    eventBusService.emit('document:updated', { id, changes })
    
    // Publish for GraphQL subscriptions
    pubsub.publish('DOCUMENT_UPDATED', { documentUpdated: doc })
  }
}
```

## Event Flow

```
User Action
    ↓
Store Mutation
    ↓
┌───────────────┬─────────────────┐
│  EventBus     │  PubSub         │
│  (sync)       │  (async)        │
│       ↓       │       ↓         │
│ SearchIndex   │ GraphQL Sub     │
│ ContextCalc   │       ↓         │
│               │ Renderer Store  │
│               │       ↓         │
│               │ UI Update       │
└───────────────┴─────────────────┘
```

## IPC Events

Cross-process communication via Electron IPC.

```typescript
// Main process
ipcMain.handle('store:update', async (event, id, changes) => {
  return store.update(id, changes)
})

// Renderer process
const result = await ipcRenderer.invoke('store:update', id, changes)
```

