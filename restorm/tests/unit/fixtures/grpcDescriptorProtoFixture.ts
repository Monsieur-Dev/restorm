/**
 * Hand-encodes a minimal, valid `google.protobuf.FileDescriptorSet` at the
 * wire-format level — the same shape a real gRPC server's reflection
 * service returns, and the same shape `@grpc/proto-loader`'s
 * `loadFileDescriptorSetFromBuffer` decodes. Building it by hand (rather
 * than depending on `protobufjs`, which is only a transitive dependency of
 * `@grpc/proto-loader` and isn't hoisted into `node_modules`) keeps the
 * reflection unit tests fully offline while still exercising the REAL
 * proto-loader decode path — not a mock of it.
 *
 * The encoded package: `demo.Greeter` — one message `Req { string value = 1; }`,
 * one message `Res { string value = 1; }`, and one unary service `Greeter`
 * with a single `Ping(Req) returns (Res)` method. Deliberately equivalent to
 * the `.proto` text used in `GrpcReflectionImportService.test.ts` /
 * `grpcDescriptorToParsedProto.test.ts` so both paths can be asserted to
 * produce the same `ParsedProto` / `EnvironmentFolder` shape.
 */

// ============================================================================
// Generic protobuf wire encoder — LEN-delimited (wire type 2) and varint
// (wire type 0) fields only, which is all `FileDescriptorProto` and its
// nested messages need for this fixture.
// ============================================================================

function encodeVarint(value: number): Buffer {
  const bytes: number[] = []
  let v = value
  do {
    let byte = v & 0x7f
    v >>>= 7
    if (v !== 0) byte |= 0x80
    bytes.push(byte)
  } while (v !== 0)
  return Buffer.from(bytes)
}

function tag(fieldNumber: number, wireType: number): Buffer {
  return encodeVarint((fieldNumber << 3) | wireType)
}

/** Encode a LEN-delimited field (string, bytes, or an embedded message). */
function lenField(fieldNumber: number, content: Buffer | string): Buffer {
  const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : content
  return Buffer.concat([tag(fieldNumber, 2), encodeVarint(bytes.length), bytes])
}

/** Encode a varint field (int32 / bool / enum). */
function varintField(fieldNumber: number, value: number): Buffer {
  return Buffer.concat([tag(fieldNumber, 0), encodeVarint(value)])
}

function concatFields(fields: Buffer[]): Buffer {
  return Buffer.concat(fields)
}

// `FieldDescriptorProto.Type` / `.Label` enum values (descriptor.proto) —
// only the ones this fixture needs.
const TYPE_STRING = 9
const LABEL_OPTIONAL = 1

/** One `FieldDescriptorProto`: `string <name> = <number>;`. */
function stringField(name: string, number: number): Buffer {
  return concatFields([
    lenField(1, name), // name
    varintField(3, number), // number
    varintField(4, LABEL_OPTIONAL), // label
    varintField(5, TYPE_STRING) // type
  ])
}

/** One `DescriptorProto` (message) with the given fields. */
function message(name: string, fields: Buffer[]): Buffer {
  return concatFields([
    lenField(1, name), // name
    ...fields.map((f) => lenField(2, f)) // field (repeated)
  ])
}

/** One `MethodDescriptorProto`: unary `<name>(<inputType>) returns (<outputType>)`. */
function method(name: string, inputType: string, outputType: string): Buffer {
  return concatFields([
    lenField(1, name), // name
    lenField(2, inputType), // input_type (fully-qualified, leading '.')
    lenField(3, outputType) // output_type
  ])
}

/** One `ServiceDescriptorProto` with the given methods. */
function service(name: string, methods: Buffer[]): Buffer {
  return concatFields([
    lenField(1, name), // name
    ...methods.map((m) => lenField(2, m)) // method (repeated)
  ])
}

/**
 * One `FileDescriptorProto`. `dependencies` are filenames of other files in
 * the set this file imports (field 3, repeated) — used by the
 * `grpcReflectionClient` transitive-dependency-resolution tests.
 */
function fileDescriptorProto(options: {
  fileName: string
  packageName: string
  dependencies?: string[]
  messages?: { name: string; fields: Buffer[] }[]
  services?: { name: string; methods: Buffer[] }[]
}): Buffer {
  return concatFields([
    lenField(1, options.fileName), // name
    lenField(2, options.packageName), // package
    ...(options.dependencies ?? []).map((d) => lenField(3, d)), // dependency (repeated)
    ...(options.messages ?? []).map((m) => lenField(4, message(m.name, m.fields))), // message_type (repeated)
    ...(options.services ?? []).map((s) => lenField(6, service(s.name, s.methods))), // service (repeated)
    lenField(12, 'proto3') // syntax
  ])
}

/** One `FileDescriptorSet.file` entry — the only field in a `FileDescriptorSet`. */
function fileDescriptorSetEntry(fdProto: Buffer): Buffer {
  return lenField(1, fdProto)
}

/**
 * The `demo.proto` file: `Req` / `Res` messages + a `Greeter.Ping` unary
 * method — encoded once and reused by every reflection test.
 */
export function buildDemoFileDescriptorProto(): Buffer {
  return fileDescriptorProto({
    fileName: 'demo.proto',
    packageName: 'demo',
    messages: [
      { name: 'Req', fields: [stringField('value', 1)] },
      { name: 'Res', fields: [stringField('value', 1)] }
    ],
    services: [
      { name: 'Greeter', methods: [method('Ping', '.demo.Req', '.demo.Res')] }
    ]
  })
}

/** `demo.proto` wrapped in a single-file `FileDescriptorSet`. */
export function buildDemoFileDescriptorSet(): Buffer {
  return fileDescriptorSetEntry(buildDemoFileDescriptorProto())
}

/** Same as {@link buildDemoFileDescriptorProto} but `Greeter` gains a second
 * unary method, `Echo` — the fixture a "server added a method" re-import
 * test fetches on its second call. */
export function buildDemoFileDescriptorProtoWithExtraMethod(): Buffer {
  return fileDescriptorProto({
    fileName: 'demo.proto',
    packageName: 'demo',
    messages: [
      { name: 'Req', fields: [stringField('value', 1)] },
      { name: 'Res', fields: [stringField('value', 1)] }
    ],
    services: [
      { name: 'Greeter', methods: [method('Ping', '.demo.Req', '.demo.Res'), method('Echo', '.demo.Req', '.demo.Res')] }
    ]
  })
}

/** {@link buildDemoFileDescriptorProtoWithExtraMethod} wrapped in a
 * single-file `FileDescriptorSet`. */
export function buildDemoFileDescriptorSetWithExtraMethod(): Buffer {
  return fileDescriptorSetEntry(buildDemoFileDescriptorProtoWithExtraMethod())
}

/** Same descriptor set, base64-encoded — the wire shape stored on
 * `GrpcRequest.protoDescriptorSet` and returned by the reflection IPC. */
export function buildDemoFileDescriptorSetBase64(): string {
  return buildDemoFileDescriptorSet().toString('base64')
}

/** The `.proto` text equivalent of {@link buildDemoFileDescriptorProto} —
 * used to assert the reflection path and the text-parser path produce the
 * same `ParsedProto` / `EnvironmentFolder` shape for equivalent content. */
export const DEMO_PROTO_TEXT = `syntax = "proto3";
package demo;

message Req { string value = 1; }
message Res { string value = 1; }

service Greeter {
  rpc Ping (Req) returns (Res);
}
`

/**
 * A second file (`extra.proto`, package `demo`) that `demo.proto` can
 * declare as a `dependency` — used to test
 * `grpcReflectionClient`'s transitive-dependency walk without a live server.
 */
export function buildExtraFileDescriptorProto(): Buffer {
  return fileDescriptorProto({
    fileName: 'extra.proto',
    packageName: 'demo',
    messages: [{ name: 'Extra', fields: [stringField('note', 1)] }]
  })
}

/** Same as {@link buildDemoFileDescriptorProto} but declaring `extra.proto`
 * as a `dependency` — the fixture the transitive-resolution test walks. */
export function buildDemoFileDescriptorProtoWithDependency(): Buffer {
  return fileDescriptorProto({
    fileName: 'demo.proto',
    packageName: 'demo',
    dependencies: ['extra.proto'],
    messages: [
      { name: 'Req', fields: [stringField('value', 1)] },
      { name: 'Res', fields: [stringField('value', 1)] }
    ],
    services: [
      { name: 'Greeter', methods: [method('Ping', '.demo.Req', '.demo.Res')] }
    ]
  })
}
