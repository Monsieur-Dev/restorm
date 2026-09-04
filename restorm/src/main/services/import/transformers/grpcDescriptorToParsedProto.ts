/**
 * Maps a `@grpc/proto-loader` `PackageDefinition` (produced by
 * `loadFileDescriptorSetFromBuffer` from a reflected `FileDescriptorSet`)
 * into the `ParsedProto` shape `GrpcImportService.ts`'s text-based `.proto`
 * parser also produces. Reusing that shape means both import paths feed the
 * same `buildEnvironmentFolderFromParsedProto` builder and produce
 * structurally identical `EnvironmentFolder`s.
 *
 * `PackageDefinition` entries are fully-qualified-name → definition. A
 * definition is a `ServiceDefinition` (a plain map of method name →
 * `MethodDefinition`, no `format` field) or a `MessageTypeDefinition` /
 * `EnumTypeDefinition` (both carry a `format` field + a `type` that is the
 * raw, already-decoded `DescriptorProto` / `EnumDescriptorProto`).
 */

import type { PackageDefinition, ServiceDefinition } from '@grpc/proto-loader'
import type { ParsedProto, ProtoEnum, ProtoField, ProtoMessage, ProtoMethod, ProtoService } from '../GrpcImportService'

/** Raw `FieldDescriptorProto` shape (as decoded by proto-loader — camelCase
 * regardless of the `keepCase` load option, which only affects runtime
 * message field naming, not these descriptor-metadata objects). */
interface RawFieldDescriptor {
  name: string
  number: number
  label: string
  type: string
  typeName: string
}

interface RawDescriptorType {
  name: string
  field?: RawFieldDescriptor[]
}

interface RawEnumValue {
  name: string
}

interface RawEnumDescriptorType {
  name: string
  value?: RawEnumValue[]
}

/** `@grpc/proto-loader` types `MessageTypeDefinition.type` as a bare `object`
 * (it's really a decoded `DescriptorProto` at runtime) — narrow just the
 * `name` a method's request/response type carries. */
interface RawTypeName {
  name: string
}

/** `FieldDescriptorProto.type` values that map onto the scalar keywords
 * `GrpcImportService`'s sample-message builder already recognises. Anything
 * else (`TYPE_MESSAGE`, `TYPE_ENUM`, `TYPE_GROUP`) is a reference to another
 * type — carry its bare `typeName` through as-is, matching how the
 * text-based parser stores message/enum field types unqualified. */
const SCALAR_TYPE_BY_DESCRIPTOR_TYPE: Record<string, string> = {
  TYPE_DOUBLE: 'double',
  TYPE_FLOAT: 'float',
  TYPE_INT64: 'int64',
  TYPE_UINT64: 'uint64',
  TYPE_INT32: 'int32',
  TYPE_FIXED64: 'fixed64',
  TYPE_FIXED32: 'fixed32',
  TYPE_BOOL: 'bool',
  TYPE_STRING: 'string',
  TYPE_BYTES: 'bytes',
  TYPE_UINT32: 'uint32',
  TYPE_SFIXED32: 'sfixed32',
  TYPE_SFIXED64: 'sfixed64',
  TYPE_SINT32: 'sint32',
  TYPE_SINT64: 'sint64'
}

function fieldTypeName(field: RawFieldDescriptor): string {
  return SCALAR_TYPE_BY_DESCRIPTOR_TYPE[field.type] ?? field.typeName.replace(/^\./, '').split('.').pop() ?? field.typeName
}

function isServiceDefinition(def: ServiceDefinition | { format: string }): def is ServiceDefinition {
  return !('format' in def)
}

function packageOf(fullyQualifiedName: string): string {
  const idx = fullyQualifiedName.lastIndexOf('.')
  return idx >= 0 ? fullyQualifiedName.slice(0, idx) : ''
}

function bareName(fullyQualifiedName: string): string {
  const idx = fullyQualifiedName.lastIndexOf('.')
  return idx >= 0 ? fullyQualifiedName.slice(idx + 1) : fullyQualifiedName
}

/**
 * Convert one reflected `PackageDefinition` into a `ParsedProto`, keeping
 * only the services the reflection session actually discovered (a
 * dependency file pulled in for a message/enum reference should never
 * contribute a spurious service to the import).
 */
export function grpcDescriptorToParsedProto(pkgDef: PackageDefinition, discoveredServiceNames: string[]): ParsedProto {
  const discovered = new Set(discoveredServiceNames)
  const servicePackages = new Set(discoveredServiceNames.map(packageOf))
  // A single common package is the overwhelmingly common case (one server,
  // one package). When reflection surfaces services from genuinely
  // different packages, fall back to an empty `parsed.package` and keep each
  // service's name fully-qualified — `methodToRequest` in
  // `GrpcImportService.ts` only prefixes `service.name` with `parsed.package`
  // when the latter is non-empty, so this keeps routing correct either way.
  const commonPackage = servicePackages.size === 1 ? (servicePackages.values().next().value ?? '') : ''

  const services: ProtoService[] = []
  const messages: ProtoMessage[] = []
  const enums: ProtoEnum[] = []

  for (const [fqName, def] of Object.entries(pkgDef)) {
    if (isServiceDefinition(def)) {
      if (!discovered.has(fqName)) continue
      const methods: ProtoMethod[] = Object.entries(def).map(([methodName, method]) => {
        const requestType = method.requestType.type as unknown as RawTypeName
        const responseType = method.responseType.type as unknown as RawTypeName
        // proto-loader decodes the MethodDescriptorProto's options onto the
        // method definition (its TS type omits `options`, but the runtime object
        // carries it) — carry a method-level `deprecated` through.
        const deprecated = (method as { options?: { deprecated?: boolean } }).options?.deprecated === true
        return {
          name: methodName,
          inputType: requestType.name,
          outputType: responseType.name,
          clientStreaming: method.requestStream,
          serverStreaming: method.responseStream,
          ...(deprecated ? { deprecated: true } : {})
        }
      })
      services.push({
        name: commonPackage ? bareName(fqName) : fqName,
        methods
      })
      continue
    }
    if (def.format === 'Protocol Buffer 3 DescriptorProto') {
      const type = def.type as unknown as RawDescriptorType
      const fields: ProtoField[] = (type.field ?? []).map((f) => ({
        name: f.name,
        type: fieldTypeName(f),
        number: f.number,
        repeated: f.label === 'LABEL_REPEATED'
      }))
      messages.push({ name: bareName(fqName), fields })
      continue
    }
    // The only remaining `AnyDefinition` member at this point is
    // `EnumTypeDefinition` — `ServiceDefinition` and `MessageTypeDefinition`
    // both `continue`d above.
    const type = def.type as unknown as RawEnumDescriptorType
    const values = (type.value ?? []).map((v) => v.name)
    enums.push({ name: bareName(fqName), values })
  }

  return { package: commonPackage, services, messages, enums }
}
