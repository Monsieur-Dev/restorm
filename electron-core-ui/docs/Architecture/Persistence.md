# Persistence

Flexible serialization supporting single file or folder-based storage.

## Formats

| Format | Extension | Use Case |
|--------|-----------|----------|
| JSON | `.json` | Standard, readable |
| YAML | `.yaml` | Human-friendly |
| JSON5 | `.json5` | Comments, trailing commas |

## Single File Mode

All data in one file.

```typescript
import { getPersistenceService } from 'electron-core-ui/main'

const service = getPersistenceService()

// Save
await service.saveSingleFile('/path/to/file.json', data, { format: 'json' })

// Load
const data = await service.loadSingleFile('/path/to/file.json')
```

## Folder Mode

Hierarchical structure based on decorators.

### Structure Example

```
collection/
├── restorm.conf           # Format configuration
├── index.yaml             # Root metadata
├── environments/
│   ├── 1 - Production.yaml
│   └── 2 - Staging.yaml
├── 1 - Users/
│   ├── index.yaml
│   ├── 1 - GET - List.yaml
│   └── 2 - POST - Create.yaml
└── 2 - Products/
    └── index.yaml
```

### Decorator-Driven Structure

```typescript
class Collection {
  name: string
  
  @separateFolders()
  @fileNaming({ pattern: '{index} - {name}' })
  folders: Folder[]
  
  @separateFiles()
  @fileNaming({ pattern: '{index} - {name}', idProperty: 'id' })
  environments: Environment[]
}
```

### Config File

`restorm.conf` at folder root stores format:

```yaml
format: yaml
```

## Runtime ID Tracking

The `idProperty` in `@fileNaming` enables:

- **Rename detection** - Track file moves when name changes
- **Delete detection** - Remove orphaned files
- **Incremental saves** - Only write changed files

```typescript
@fileNaming({
  pattern: '{index} - {type} - {name}',
  idProperty: 'id'  // Runtime-only, not persisted
})
```

## FolderMappingService

Tracks `id → path` mappings for rename/delete operations.

```typescript
import { folderMappingService } from './services/FolderMappingService'

// On load: build mapping
folderMappingService.buildMapping(basePath, data, 'id')

// On save: track changes
folderMappingService.startSaveSession()
folderMappingService.markAsSeen(id, newPath)
const orphaned = folderMappingService.getOrphanedPaths()
folderMappingService.commitSaveSession()
```

