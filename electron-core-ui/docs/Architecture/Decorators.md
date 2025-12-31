# Decorators

TypeScript decorators for defining model behavior, serialization, and persistence.

## Available Decorators

### @trackable()

Marks a class as trackable for change detection.

```typescript
@trackable()
class Document {
  id: string
  name: string
}
```

### @searchable(config)

Enables search indexing for the class.

```typescript
@searchable({
  fields: ['name', 'description'],
  boost: { name: 2 }
})
class Item { }
```

### @NonSerialised()

Excludes a property from serialization.

```typescript
class Document {
  name: string
  
  @NonSerialised()
  runtimeCache: Map<string, unknown>
}
```

### @separateFolders()

In folder mode, creates a subfolder for each item in an array.

```typescript
class Collection {
  @separateFolders()
  items: Item[]
}
```

### @separateFiles()

In folder mode, creates a separate file for each item in an array.

```typescript
class Folder {
  @separateFiles()
  requests: Request[]
}
```

### @fileNaming(config)

Defines file naming pattern for folder mode.

```typescript
@fileNaming({
  pattern: '{index} - {type} - {name}',
  typeProperty: 'method',
  nameProperty: 'name',
  idProperty: 'id'
})
class Request { }
```

**Config options:**
- `pattern` - Template string with placeholders
- `typeProperty` - Property for `{type}` placeholder
- `nameProperty` - Property for `{name}` placeholder  
- `idProperty` - Property used for tracking renames/deletes

## Metadata Access

```typescript
import { getTrackableMetadata, getSearchableMetadata } from 'electron-core-ui/main'

const trackable = getTrackableMetadata(MyClass)
const searchable = getSearchableMetadata(MyClass)
```

