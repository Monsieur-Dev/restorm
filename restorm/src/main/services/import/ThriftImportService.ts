/**
 * Service for importing Apache Thrift IDL (.thrift) files into Restorm collections.
 *
 * Thrift services communicate over their own binary wire protocol rather than
 * HTTP, so v1 import is documentation-only: services, methods, structs and
 * enums are parsed and surfaced through `apiDocumentation`, but no executable
 * request is produced. Executing Thrift RPCs would need a dedicated execution
 * service (protocol + scenario node) — a follow-up if there's demand.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  parse as parseThriftSource,
  SyntaxType,
  type FieldDefinition,
  type FieldType,
  type FunctionDefinition,
  type FunctionType,
  type StructLike,
  type ThriftDocument,
  type ThriftStatement
} from '@creditkarma/thrift-parser'
import { logger } from 'electron-core-ui'
import { Folder, EnvironmentFolder } from '../../../shared/models'
import type { EnumDefinition } from '../../../shared/types/collections'
import { isPathContained } from '../../utils/pathSecurity'
import { stableImportId as generateId } from './stableImportId'
import { thriftToApiDocumentation, type ParsedThriftData } from './transformers/thriftToApiDocumentation'

// ============================================================================
// Parsed Thrift Types
// ============================================================================

interface ThriftFieldInfo {
  name: string
  type: string
  required: boolean
}

interface ThriftStructInfo {
  name: string
  fields: ThriftFieldInfo[]
}

interface ThriftMethodInfo {
  name: string
  args: ThriftFieldInfo[]
  returnType: string
  oneway: boolean
}

interface ThriftServiceInfo {
  name: string
  extendsService?: string | undefined
  methods: ThriftMethodInfo[]
}

interface ThriftEnumInfo {
  name: string
  values: string[]
}

interface ParsedThrift {
  namespace: string
  services: ThriftServiceInfo[]
  structs: ThriftStructInfo[]
  enums: ThriftEnumInfo[]
}

// ============================================================================
// Parser
// ============================================================================

/** Primitive Thrift keyword types → their display string in the docs. */
const BASE_TYPE_NAMES: Partial<Record<SyntaxType, string>> = {
  [SyntaxType.StringKeyword]: 'string',
  [SyntaxType.BoolKeyword]: 'bool',
  [SyntaxType.ByteKeyword]: 'byte',
  [SyntaxType.I8Keyword]: 'i8',
  [SyntaxType.I16Keyword]: 'i16',
  [SyntaxType.I32Keyword]: 'i32',
  [SyntaxType.I64Keyword]: 'i64',
  [SyntaxType.DoubleKeyword]: 'double',
  [SyntaxType.BinaryKeyword]: 'binary'
}

/**
 * Resolve a Thrift field/return type down to a display string. `typedef`s
 * carry no separate identity in the docs — they are followed to their
 * underlying representation — while struct and enum names are kept as-is so
 * they can be cross-referenced via `referencedModels`.
 */
function typeToString(type: FunctionType, typedefs: Map<string, FieldType>, seen: Set<string> = new Set<string>()): string {
  switch (type.type) {
    case SyntaxType.VoidKeyword:
      return 'void'
    case SyntaxType.ListType:
      return `list<${typeToString(type.valueType, typedefs, seen)}>`
    case SyntaxType.SetType:
      return `set<${typeToString(type.valueType, typedefs, seen)}>`
    case SyntaxType.MapType:
      return `map<${typeToString(type.keyType, typedefs, seen)}, ${typeToString(type.valueType, typedefs, seen)}>`
    case SyntaxType.Identifier: {
      const name = type.value
      const aliased = typedefs.get(name)
      if (aliased && !seen.has(name)) {
        return typeToString(aliased, typedefs, new Set(seen).add(name))
      }
      return name
    }
    default:
      // Remaining case: BaseType — its `type` field holds the specific
      // keyword syntax type (StringKeyword, I32Keyword, ...).
      return BASE_TYPE_NAMES[type.type] ?? type.type
  }
}

function fieldToInfo(field: FieldDefinition, typedefs: Map<string, FieldType>): ThriftFieldInfo {
  return {
    name: field.name.value,
    type: typeToString(field.fieldType, typedefs),
    // Thrift's default requiredness (no `required`/`optional` keyword) behaves
    // as required for documentation purposes — only an explicit `optional`
    // marks the field as such.
    required: field.requiredness !== 'optional'
  }
}

function structLikeToInfo(node: StructLike, typedefs: Map<string, FieldType>): ThriftStructInfo {
  return {
    name: node.name.value,
    fields: node.fields.map((f) => fieldToInfo(f, typedefs))
  }
}

function functionToInfo(fn: FunctionDefinition, typedefs: Map<string, FieldType>): ThriftMethodInfo {
  return {
    name: fn.name.value,
    args: fn.fields.map((f) => fieldToInfo(f, typedefs)),
    returnType: typeToString(fn.returnType, typedefs),
    oneway: fn.oneway
  }
}

function parseThriftDocument(content: string): ThriftDocument {
  const result = parseThriftSource(content)
  if (result.type === SyntaxType.ThriftErrors) {
    const messages = result.errors.map((e) => e.message).join('; ')
    throw new Error(`Failed to parse Thrift IDL: ${messages}`)
  }
  return result
}

/**
 * Flatten a document's body together with its `include`d files, resolved
 * relative to `basePath`'s directory (basic same-directory resolution only —
 * an include that can't be resolved this way logs a warning and is skipped
 * rather than failing the whole import; see `docs/imports/thrift.md`).
 */
function collectStatements(
  body: ThriftStatement[],
  basePath: string | undefined,
  visitedIncludes: Set<string>
): ThriftStatement[] {
  const out: ThriftStatement[] = []
  for (const statement of body) {
    out.push(statement)
    if (statement.type !== SyntaxType.IncludeDefinition) continue

    if (!basePath) {
      logger.warn(`[ThriftImportService] Skipping include "${statement.path.value}" — no source file path to resolve it against`)
      continue
    }
    const includeDir = dirname(basePath)
    const includePath = join(includeDir, statement.path.value)
    if (visitedIncludes.has(includePath)) continue
    visitedIncludes.add(includePath)

    // `statement.path.value` is untrusted content from the imported IDL — an
    // absolute path or a `../` escape must never reach the filesystem calls
    // below (arbitrary local-file read via a hostile `.thrift` file).
    if (!isPathContained(includeDir, includePath)) {
      logger.warn(`[ThriftImportService] Skipping include "${statement.path.value}" — resolves outside the source file's directory`)
      continue
    }

    if (!existsSync(includePath)) {
      logger.warn(`[ThriftImportService] Could not resolve include "${statement.path.value}" — file not found at ${includePath}`)
      continue
    }
    try {
      const includedContent = readFileSync(includePath, 'utf-8')
      const includedDocument = parseThriftDocument(includedContent)
      out.push(...collectStatements(includedDocument.body, includePath, visitedIncludes))
    } catch (error) {
      logger.warn(`[ThriftImportService] Failed to parse include "${statement.path.value}": ${String(error)}`)
    }
  }
  return out
}

/** Parse `.thrift` IDL content into the flat structures the importer + docs
 * transformer both consume. `filePath` (absent for pasted content) anchors
 * relative `include` resolution. */
function parseThrift(content: string, filePath?: string): ParsedThrift {
  const document = parseThriftDocument(content)
  const statements = collectStatements(document.body, filePath, new Set(filePath ? [filePath] : []))

  const typedefs = new Map<string, FieldType>()
  for (const statement of statements) {
    if (statement.type === SyntaxType.TypedefDefinition) {
      typedefs.set(statement.name.value, statement.definitionType)
    }
  }

  let namespace = ''
  const structs: ThriftStructInfo[] = []
  const enums: ThriftEnumInfo[] = []
  const services: ThriftServiceInfo[] = []

  for (const statement of statements) {
    switch (statement.type) {
      case SyntaxType.NamespaceDefinition:
        if (!namespace) namespace = statement.name.value
        break
      case SyntaxType.StructDefinition:
      case SyntaxType.UnionDefinition:
      case SyntaxType.ExceptionDefinition:
        structs.push(structLikeToInfo(statement, typedefs))
        break
      case SyntaxType.EnumDefinition:
        enums.push({
          name: statement.name.value,
          values: statement.members.map((m) => m.name.value)
        })
        break
      case SyntaxType.ServiceDefinition:
        services.push({
          name: statement.name.value,
          extendsService: statement.extends?.value,
          methods: statement.functions.map((fn) => functionToInfo(fn, typedefs))
        })
        break
      default:
        break
    }
  }

  // `extends` — a service inherits every method of the service it extends,
  // unless it redeclares one of its own. Single-level lookup by name.
  const byName = new Map(services.map((s) => [s.name, s]))
  for (const service of services) {
    if (!service.extendsService) continue
    const parent = byName.get(service.extendsService)
    if (!parent) {
      logger.warn(`[ThriftImportService] Service "${service.name}" extends unknown service "${service.extendsService}"`)
      continue
    }
    const ownNames = new Set(service.methods.map((m) => m.name))
    service.methods = [...parent.methods.filter((m) => !ownNames.has(m.name)), ...service.methods]
  }

  return { namespace, structs, enums, services }
}

// ============================================================================
// Main Service
// ============================================================================

export interface ThriftImportOptions {
  /** Name for the imported collection (defaults to the IDL's namespace). */
  name?: string
  /** Original URL/path the IDL was fetched from (stored on ApiDocumentation.sourceUrl). */
  sourceUrl?: string
  /** Local path the content was read from — anchors relative `include` resolution. */
  filePath?: string
}

/**
 * Import a `.thrift` IDL file and convert it to a Folder structure.
 * Documentation-only: services materialise as empty folders (no requests),
 * and the full operation/model/enum detail lives on `apiDocumentation`.
 */
export function importThrift(idlContent: string, options: ThriftImportOptions = {}): EnvironmentFolder {
  const parsed = parseThrift(idlContent, options.filePath)
  const name = options.name ?? (parsed.namespace !== '' ? parsed.namespace : 'Thrift API')

  const items: Folder['items'] = parsed.services.map((service) => ({
    id: generateId(`${name}:folder:thrift:${service.name}`),
    name: service.name,
    tags: ['service'],
    configuration: {},
    items: []
  }))

  const apiSpec: ParsedThriftData = {
    namespace: parsed.namespace,
    services: parsed.services.map((s) => ({ name: s.name, methods: s.methods })),
    structs: parsed.structs
  }
  const apiDocumentation = thriftToApiDocumentation(apiSpec, {
    name,
    ...(options.sourceUrl !== undefined ? { sourceUrl: options.sourceUrl } : {})
  })

  const enumDefinitions: EnumDefinition[] = parsed.enums.map((e) => ({
    id: generateId(`enum:thrift:${e.name}`),
    name: e.name,
    values: e.values,
    matchingRules: []
  }))

  const rootFolder: EnvironmentFolder = {
    folderType: 'environment',
    importSource: 'thrift',
    id: generateId(`${name}:folder:thrift:root`),
    name,
    tags: [],
    configuration: {},
    environments: [],
    items,
    apiDocumentation,
    ...(enumDefinitions.length > 0 ? { enumDefinitions } : {})
  }

  return rootFolder
}

/** Import a `.thrift` IDL file from a raw string. */
export function importThriftFromString(content: string, options: ThriftImportOptions = {}): EnvironmentFolder {
  return importThrift(content, options)
}

// ============================================================================
// Provider registration
// ============================================================================

import { importProviders } from './registry'

function canImport(content: string, filePath?: string): boolean {
  if (filePath?.endsWith('.thrift')) return true
  return /^\s*(namespace|service)\b/m.test(content)
}

importProviders.push({
  format: 'thrift',
  canImport,
  parse: (content, opts) => importThrift(content, opts)
})
