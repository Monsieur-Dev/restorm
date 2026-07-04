import { describe, it, expect } from 'vitest'
import * as protoLoader from '@grpc/proto-loader'
import { grpcDescriptorToParsedProto } from '../../../../src/main/services/import/transformers/grpcDescriptorToParsedProto'
import { buildEnvironmentFolderFromParsedProto, importGrpc } from '../../../../src/main/services/import/GrpcImportService'
import { buildDemoFileDescriptorSet, DEMO_PROTO_TEXT } from '../../fixtures/grpcDescriptorProtoFixture'
import type { FolderItem, GrpcRequest } from '../../../../src/shared/types/collections'
import { isAnyFolder, isRequest, isGrpcRequest } from '../../../../src/shared/types/collections'

/** Collect every gRPC request in an imported tree (folders can nest). */
function findGrpcRequests(items: FolderItem[]): GrpcRequest[] {
  const out: GrpcRequest[] = []
  for (const item of items) {
    if (isAnyFolder(item)) out.push(...findGrpcRequests(item.items))
    else if (isRequest(item) && isGrpcRequest(item)) out.push(item)
  }
  return out
}

const LOAD_OPTIONS: protoLoader.Options = { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true }

/** Strip fields that are expected to differ before a structural comparison:
 * generated `id`s (both builders mint fresh random ids on every call), and
 * the proto-source stamp (`importGrpc` stamps `protoContent` with the raw
 * `.proto` text it was given; `buildEnvironmentFolderFromParsedProto` called
 * directly — the reflection path's entry point — has no such text to stamp
 * and instead carries its own `protoDescriptorSet` stamped separately by the
 * reflection importer, not by this builder). Everything else about the two
 * trees — folders, requests, sample messages, enums — must still match. */
function stripVolatile(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripVolatile)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => k !== 'id' && k !== 'protoContent' && k !== 'protoDescriptorSet')
        .map(([k, v]) => [k, stripVolatile(v)])
    )
  }
  return value
}

/**
 * `grpcDescriptorToParsedProto` maps a reflected `PackageDefinition` — the
 * decoded shape `@grpc/proto-loader.loadFileDescriptorSetFromBuffer` produces
 * from a real, wire-encoded `FileDescriptorSet` (built by hand in the
 * fixture, no protobufjs/protoc dependency) — into the same `ParsedProto`
 * shape the text-based `.proto` parser produces internally. Both paths
 * funnel into `buildEnvironmentFolderFromParsedProto`, so a reflection
 * import is structurally indistinguishable from a proto-file import of the
 * equivalent `.proto` text — aside from the proto-source stamp each import
 * path attaches for execution (see `stripVolatile`), which is expected to
 * differ.
 */
describe('grpcDescriptorToParsedProto', () => {
  it('maps a reflected service + its messages into a ParsedProto', () => {
    const pkgDef = protoLoader.loadFileDescriptorSetFromBuffer(buildDemoFileDescriptorSet(), LOAD_OPTIONS)
    const reflected = grpcDescriptorToParsedProto(pkgDef, ['demo.Greeter'])

    expect(reflected.package).toBe('demo')
    expect(reflected.services).toEqual([
      { name: 'Greeter', methods: [{ name: 'Ping', inputType: 'Req', outputType: 'Res', clientStreaming: false, serverStreaming: false }] }
    ])
    const byName = Object.fromEntries(reflected.messages.map((m) => [m.name, m]))
    expect(byName.Req).toEqual({ name: 'Req', fields: [{ name: 'value', type: 'string', number: 1, repeated: false }] })
    expect(byName.Res).toEqual({ name: 'Res', fields: [{ name: 'value', type: 'string', number: 1, repeated: false }] })
  })

  it('drops services from a dependency file that reflection did not discover', () => {
    const pkgDef = protoLoader.loadFileDescriptorSetFromBuffer(buildDemoFileDescriptorSet(), LOAD_OPTIONS)
    // Pretend the reflection session only discovered a DIFFERENT service —
    // `demo.Greeter` must not leak into the result even though it's present
    // in the decoded package definition (a message/enum dependency pulled
    // in to describe some other service must never surface a spurious one).
    const reflected = grpcDescriptorToParsedProto(pkgDef, ['demo.NotGreeter'])
    expect(reflected.services).toEqual([])
  })

  it('feeds into the SAME EnvironmentFolder builder as a text-based import, producing a structurally identical tree', () => {
    const pkgDef = protoLoader.loadFileDescriptorSetFromBuffer(buildDemoFileDescriptorSet(), LOAD_OPTIONS)
    const reflected = grpcDescriptorToParsedProto(pkgDef, ['demo.Greeter'])

    const fromReflection = buildEnvironmentFolderFromParsedProto(reflected, { baseUrl: 'localhost:9000' })
    const fromProtoFile = importGrpc(DEMO_PROTO_TEXT, { baseUrl: 'localhost:9000' })

    expect(stripVolatile(fromReflection)).toEqual(stripVolatile(fromProtoFile))

    // The one deliberate difference `stripVolatile` hides above: only the
    // text-based import stamps the raw `.proto` it was given onto each
    // request (so execution loads the imported descriptor instead of the
    // grpcbin fallback). `buildEnvironmentFolderFromParsedProto` called
    // directly — as the reflection path does — has no such text to stamp.
    findGrpcRequests(fromProtoFile.items).forEach((req) => {
      expect(req.protoContent).toBe(DEMO_PROTO_TEXT)
    })
    findGrpcRequests(fromReflection.items).forEach((req) => {
      expect(req.protoContent).toBeUndefined()
    })
  })
})
