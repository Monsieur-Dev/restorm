import { describe, it, expect } from 'vitest'
import * as protoLoader from '@grpc/proto-loader'
import { grpcDescriptorToParsedProto } from '../../../../src/main/services/import/transformers/grpcDescriptorToParsedProto'
import { buildEnvironmentFolderFromParsedProto, importGrpc } from '../../../../src/main/services/import/GrpcImportService'
import { buildDemoFileDescriptorSet, DEMO_PROTO_TEXT } from '../../fixtures/grpcDescriptorProtoFixture'

const LOAD_OPTIONS: protoLoader.Options = { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true }

/** Strip generated `id` fields before a structural comparison — both
 * builders mint fresh random ids on every call, so ids always differ even
 * for otherwise-identical trees. */
function stripIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripIds)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => k !== 'id')
        .map(([k, v]) => [k, stripIds(v)])
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
 * equivalent `.proto` text.
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

  it('feeds into the SAME EnvironmentFolder builder as a text-based import, producing an identical tree', () => {
    const pkgDef = protoLoader.loadFileDescriptorSetFromBuffer(buildDemoFileDescriptorSet(), LOAD_OPTIONS)
    const reflected = grpcDescriptorToParsedProto(pkgDef, ['demo.Greeter'])

    const fromReflection = buildEnvironmentFolderFromParsedProto(reflected, { baseUrl: 'localhost:9000' })
    const fromProtoFile = importGrpc(DEMO_PROTO_TEXT, { baseUrl: 'localhost:9000' })

    expect(stripIds(fromReflection)).toEqual(stripIds(fromProtoFile))
  })
})
