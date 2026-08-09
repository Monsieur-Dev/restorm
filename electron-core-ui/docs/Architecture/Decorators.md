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

### @TreatEmptyAsUndefined()

Marks a string property so that `null`, `undefined`, and `""` are
treated as equivalent — normalized to `undefined` before both checksum
calculation and serialization. Whitespace-only strings (`"   "`) are
**not** normalized (no implicit trim).

```typescript
class Note {
  name: string

  @TreatEmptyAsUndefined()
  body: string | null | undefined
}
```

Use case: rich-text editors like Milkdown leave an empty `""` when the
user backspaces all content. Without this decorator, the checksum
registers a change relative to a never-filled field and trips the
dirty flag falsely.

### @saveUnits()

Marks an array property whose items are each their own SAVE UNIT: the
save-unit decomposer walks them into independent entries so per-unit
dirty state, drafts and per-unit Ctrl+S can address them individually.
Whether an item is a container (holding further units) or a leaf is
derived from the item's own class carrying `@saveUnits` itself.

```typescript
class Collection {
  @saveUnits()
  items: Item[]
}
```

### @fileNaming(config)

Defines the naming pattern the save-unit decomposer uses for unit
identities. The recommended pattern is `{index} - {name}` — no `{type}`
prefix. The counter alone differentiates siblings with duplicate names.

```typescript
@fileNaming({
  pattern: '{index} - {name}',
  nameProperty: 'name',
  idProperty: 'id'
})
class Request { }
```

**Config options:**
- `pattern` - Template string with placeholders
- `typeProperty` - Property for `{type}` placeholder (legacy; avoid)
- `nameProperty` - Property for `{name}` placeholder  
- `idProperty` - Property used for tracking renames/deletes

### @graphqlType(config)

Optional class decorator to customize GraphQL type name.

```typescript
@graphqlType({ name: 'CustomTypeName', description: 'A custom type' })
class MyClass { }
```

**Config options:**
- `name` - GraphQL type name (defaults to class name)
- `description` - Description for GraphQL schema

### @graphqlField(config)

Marks a property as a GraphQL field with type information. Used with `registerClassAuto()` to automatically generate GraphQL schema from decorators.

```typescript
class HTTPRequest {
  @graphqlField({ type: 'String' })
  id!: string

  @graphqlField({ type: 'HTTPMethod' })
  method: HTTPMethod = 'GET'

  @graphqlField({ type: 'KeyValue', isArray: true })
  headers: KeyValue[] = []

  @graphqlField({ type: 'JSON', nullable: true })
  body?: object
}

// In schema config:
graphQLSchemaGenerator.registerClassAuto(HTTPRequest, { skipGenericQueries: true })
```

**Config options:**
- `type` - GraphQL type name (e.g., 'String', 'Int', 'Boolean', 'KeyValue', enum name)
- `nullable` - Whether the field can be null (default: false)
- `isArray` - Whether the field is an array (default: false)
- `description` - Description for GraphQL schema

## Metadata Access

```typescript
import {
  getTrackableConfig,
  getSearchableConfig,
  getGraphQLFields,
  getGraphQLTypeConfig
} from 'electron-core-ui/main'

const trackable = getTrackableConfig(MyClass)
const searchable = getSearchableConfig(MyClass)
const graphqlFields = getGraphQLFields(MyClass) // Map<string, GraphQLFieldConfig>
const graphqlType = getGraphQLTypeConfig(MyClass)
```

