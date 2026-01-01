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

