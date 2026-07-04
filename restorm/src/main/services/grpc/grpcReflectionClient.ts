/**
 * gRPC server reflection client (`grpc.reflection.v1alpha.ServerReflection`).
 *
 * Lets Restorm discover a running server's services + methods + message
 * types without a `.proto` file: it opens the reflection service's
 * bidirectional `ServerReflectionInfo` stream, lists the server's services,
 * then walks each service's `FileDescriptorProto` (plus its transitive
 * `dependency` imports) until the full descriptor set is resolved. The
 * result is handed to `@grpc/proto-loader`'s own `loadFileDescriptorSetFromBuffer`
 * — the same decoder `grpcProtoLoader.ts` uses for a `.proto`-file import —
 * so reflection-derived services are structurally identical to file-parsed
 * ones. No extra dependency: everything here runs on `@grpc/grpc-js` +
 * `@grpc/proto-loader`, already used by the rest of the gRPC surface.
 */

import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'

/**
 * The well-known `grpc.reflection.v1alpha.ServerReflection` service, verbatim
 * from https://github.com/grpc/grpc/blob/master/src/proto/grpc/reflection/v1alpha/reflection.proto
 * (Apache-2.0). Stable across gRPC releases — this is the wire contract every
 * reflection-enabled server implements, not something Restorm controls.
 */
const REFLECTION_V1ALPHA_PROTO = `syntax = "proto3";

package grpc.reflection.v1alpha;

service ServerReflection {
  rpc ServerReflectionInfo(stream ServerReflectionRequest)
      returns (stream ServerReflectionResponse);
}

message ServerReflectionRequest {
  string host = 1;
  oneof message_request {
    string file_by_filename = 3;
    string file_containing_symbol = 4;
    ExtensionRequest file_containing_extension = 5;
    string all_extension_numbers_of_type = 6;
    string list_services = 7;
  }
}

message ExtensionRequest {
  string containing_type = 1;
  int32 extension_number = 2;
}

message ServerReflectionResponse {
  string valid_host = 1;
  ServerReflectionRequest original_request = 2;
  oneof message_response {
    FileDescriptorResponse file_descriptor_response = 4;
    ExtensionNumberResponse all_extension_numbers_response = 5;
    ListServiceResponse list_services_response = 6;
    ErrorResponse error_response = 7;
  }
}

message FileDescriptorResponse {
  repeated bytes file_descriptor_proto = 1;
}

message ExtensionNumberResponse {
  string base_type_name = 1;
  repeated int32 extension_number = 2;
}

message ListServiceResponse {
  repeated ServiceResponse service = 1;
}

message ServiceResponse {
  string name = 1;
}

message ErrorResponse {
  int32 error_code = 1;
  string error_message = 2;
}
`

const REFLECTION_LOAD_OPTIONS: protoLoader.Options = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
}

let reflectionPackage: grpc.GrpcObject | undefined
let reflectionTmpDir: string | undefined

/** Load the bundled reflection proto once per process (mirrors the
 * temp-file materialisation `grpcProtoLoader.ts` uses for inline content —
 * `@grpc/proto-loader` only loads from disk). */
function loadReflectionPackage(): grpc.GrpcObject {
  if (reflectionPackage) return reflectionPackage
  reflectionTmpDir ??= mkdtempSync(join(tmpdir(), 'restorm-grpc-reflection-'))
  const file = join(reflectionTmpDir, 'reflection.proto')
  if (!existsSync(file)) writeFileSync(file, REFLECTION_V1ALPHA_PROTO, 'utf8')
  const pkgDef = protoLoader.loadSync(file, REFLECTION_LOAD_OPTIONS)
  reflectionPackage = grpc.loadPackageDefinition(pkgDef)
  return reflectionPackage
}

/** Thrown when the target server doesn't implement
 * `grpc.reflection.v1alpha.ServerReflection` (UNIMPLEMENTED / stream error
 * before any response arrives). Callers surface the user-facing message. */
export class GrpcReflectionUnsupportedError extends Error {
  constructor(address: string, cause?: unknown) {
    super(`gRPC server at "${address}" does not support server reflection`)
    this.name = 'GrpcReflectionUnsupportedError'
    if (cause !== undefined) this.cause = cause
  }
}

export interface GrpcReflectionOptions {
  /** Use a TLS channel instead of insecure (default: insecure). */
  tls?: boolean
  /** Metadata (headers) sent with the reflection call — e.g. an auth token
   * some servers require even for reflection. */
  metadata?: { key: string; value: string }[]
}

export interface GrpcReflectionResult {
  /** Fully-qualified service names the server reported, minus the
   * reflection service itself (not user-meaningful as an importable API). */
  services: string[]
  /** The resolved, deduplicated `FileDescriptorSet` — every file needed to
   * fully describe `services`, transitive `dependency` imports included.
   * Serialised (wire bytes) so it round-trips through storage untouched. */
  fileDescriptorSet: Buffer
}

const RESERVED_REFLECTION_SERVICE_NAMES = new Set([
  'grpc.reflection.v1alpha.ServerReflection',
  'grpc.reflection.v1.ServerReflection'
])

// ============================================================================
// Minimal FileDescriptorProto wire peek
// ============================================================================
// We only need two fields to resolve transitive imports: `name` (field 1)
// and `dependency` (field 3, repeated) — both stable, decades-old field
// numbers in google/protobuf/descriptor.proto. Reading just these two lets
// us drive the "fetch missing dependency by filename" loop without pulling
// in a full protobuf runtime (protobufjs is already a transitive dependency
// of `@grpc/proto-loader`, but importing it directly here would need it
// promoted to a direct dependency for no benefit over these ~20 lines).

function readVarint(buf: Buffer, offset: number): { value: number; next: number } {
  let result = 0
  let shift = 0
  let pos = offset
  for (;;) {
    const byte = buf[pos]
    if (byte === undefined) throw new Error('truncated varint while scanning FileDescriptorProto')
    result |= (byte & 0x7f) << shift
    pos++
    if ((byte & 0x80) === 0) break
    shift += 7
  }
  return { value: result >>> 0, next: pos }
}

/** Peek a serialized `FileDescriptorProto`'s `name` + `dependency` fields
 * without decoding the rest of the message. */
export function peekFileDescriptorNameAndDependencies(buf: Buffer): { name?: string; dependencies: string[] } {
  let offset = 0
  let name: string | undefined
  const dependencies: string[] = []
  while (offset < buf.length) {
    const tag = readVarint(buf, offset)
    const fieldNumber = tag.value >>> 3
    const wireType = tag.value & 0x7
    offset = tag.next
    if (wireType === 2) {
      const len = readVarint(buf, offset)
      const start = len.next
      const end = start + len.value
      if (fieldNumber === 1) name = buf.toString('utf8', start, end)
      else if (fieldNumber === 3) dependencies.push(buf.toString('utf8', start, end))
      offset = end
    } else if (wireType === 0) {
      offset = readVarint(buf, offset).next
    } else if (wireType === 5) {
      offset += 4
    } else if (wireType === 1) {
      offset += 8
    } else {
      throw new Error(`unsupported wire type ${wireType} while scanning FileDescriptorProto`)
    }
  }
  return { name, dependencies }
}

/** Encode one `FileDescriptorSet.file` entry (field 1, LEN-delimited) for a
 * given serialized `FileDescriptorProto`. Concatenating one of these per file
 * IS a valid serialized `FileDescriptorSet` — its only field is
 * `repeated FileDescriptorProto file = 1`. */
function encodeFileDescriptorSetEntry(fileDescriptorProto: Buffer): Buffer {
  const len = fileDescriptorProto.length
  const varint: number[] = []
  let v = len
  do {
    let byte = v & 0x7f
    v >>>= 7
    if (v !== 0) byte |= 0x80
    varint.push(byte)
  } while (v !== 0)
  return Buffer.concat([Buffer.from([0x0a, ...varint]), fileDescriptorProto])
}

/** Build a serialized `FileDescriptorSet` from the resolved file buffers. */
export function buildFileDescriptorSetBuffer(files: Buffer[]): Buffer {
  return Buffer.concat(files.map(encodeFileDescriptorSetEntry))
}

// ============================================================================
// Reflection session (sequential request/response over one bidi stream)
// ============================================================================

interface ReflectionRequest {
  host: string
  list_services?: string
  file_containing_symbol?: string
  file_by_filename?: string
}

interface ReflectionResponse {
  list_services_response?: { service?: { name: string }[] }
  file_descriptor_response?: { file_descriptor_proto?: Buffer[] }
  error_response?: { error_code: number; error_message: string }
}

type ReflectionDuplex = grpc.ClientDuplexStream<ReflectionRequest, ReflectionResponse>

/** Send one request on the shared stream and resolve with the matching
 * response. The reflection RPC is defined to answer requests in order on a
 * single stream, so a simple FIFO queue of pending resolvers is sufficient —
 * no request needs to be in flight concurrently with another. */
function createReflectionSession(call: ReflectionDuplex): {
  send: (req: ReflectionRequest) => Promise<ReflectionResponse>
  close: () => void
} {
  const pending: { resolve: (r: ReflectionResponse) => void; reject: (e: unknown) => void }[] = []
  let ended = false

  call.on('data', (response: ReflectionResponse) => {
    const next = pending.shift()
    next?.resolve(response)
  })
  call.on('error', (err) => {
    ended = true
    let waiter
    while ((waiter = pending.shift())) waiter.reject(err)
  })
  call.on('end', () => {
    ended = true
    let waiter
    while ((waiter = pending.shift())) waiter.reject(new Error('gRPC reflection stream ended before a response arrived'))
  })

  return {
    send(req) {
      if (ended) return Promise.reject(new Error('gRPC reflection stream is closed'))
      return new Promise<ReflectionResponse>((resolve, reject) => {
        pending.push({ resolve, reject })
        call.write(req)
      })
    },
    close() {
      if (!ended) call.end()
    }
  }
}

/**
 * Query a running gRPC server's reflection service: list its services, then
 * resolve every `FileDescriptorProto` needed to fully describe them
 * (following `dependency` imports transitively).
 *
 * Throws {@link GrpcReflectionUnsupportedError} when the server doesn't
 * implement the reflection service (the stream errors before the first
 * response, or every request comes back `UNIMPLEMENTED`).
 */
export async function queryReflection(address: string, options: GrpcReflectionOptions = {}): Promise<GrpcReflectionResult> {
  const root = loadReflectionPackage()
  const ctor = (root as { grpc: { reflection: { v1alpha: { ServerReflection: grpc.ServiceClientConstructor } } } })
    .grpc.reflection.v1alpha.ServerReflection
  const credentials = options.tls === true ? grpc.credentials.createSsl() : grpc.credentials.createInsecure()
  const client = new ctor(address, credentials) as grpc.Client & {
    serverReflectionInfo: () => ReflectionDuplex
  }
  const metadata = new grpc.Metadata()
  for (const kv of options.metadata ?? []) metadata.set(kv.key, kv.value)

  let call: ReflectionDuplex
  try {
    call = client.serverReflectionInfo(metadata)
  } catch (error) {
    client.close()
    throw new GrpcReflectionUnsupportedError(address, error)
  }
  const session = createReflectionSession(call)

  try {
    const listResponse = await session.send({ host: '', list_services: '' })
    if (listResponse.error_response) {
      throw new GrpcReflectionUnsupportedError(address, listResponse.error_response.error_message)
    }
    const allServices = (listResponse.list_services_response?.service ?? []).map((s) => s.name)
    const services = allServices.filter((name) => !RESERVED_REFLECTION_SERVICE_NAMES.has(name))
    if (services.length === 0 && allServices.length === 0) {
      throw new GrpcReflectionUnsupportedError(address)
    }

    const collected = new Map<string, Buffer>()
    const pendingFiles = new Set<string>()

    const ingest = (buffers: Buffer[] | undefined): void => {
      for (const buf of buffers ?? []) {
        const { name, dependencies } = peekFileDescriptorNameAndDependencies(buf)
        const key = name ?? `#${collected.size}`
        if (!collected.has(key)) collected.set(key, buf)
        for (const dep of dependencies) {
          if (!collected.has(dep)) pendingFiles.add(dep)
        }
      }
    }

    for (const service of services) {
      const response = await session.send({ host: '', file_containing_symbol: service })
      if (response.error_response) {
        throw new Error(`gRPC reflection error resolving "${service}": ${response.error_response.error_message}`)
      }
      ingest(response.file_descriptor_response?.file_descriptor_proto)
    }

    while (pendingFiles.size > 0) {
      const [filename] = pendingFiles
      pendingFiles.delete(filename)
      if (collected.has(filename)) continue
      const response = await session.send({ host: '', file_by_filename: filename })
      if (response.error_response) {
        throw new Error(`gRPC reflection error resolving dependency "${filename}": ${response.error_response.error_message}`)
      }
      ingest(response.file_descriptor_response?.file_descriptor_proto)
    }

    return {
      services,
      fileDescriptorSet: buildFileDescriptorSetBuffer([...collected.values()])
    }
  } finally {
    session.close()
    client.close()
  }
}
