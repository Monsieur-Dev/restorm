/**
 * gRPC proto loading + dynamic client resolution.
 *
 * `@grpc/proto-loader` only loads from a file on disk, so proto *content*
 * (bundled string, or an inline `protoContent` on a request) is materialised to
 * a temp file once and `loadSync`-ed; the resulting package definition is cached
 * by a content hash so repeated executions don't re-parse. A request can also
 * point at a `.proto` file directly (`protoPath`) — then we load that path.
 *
 * grpcbin (the docker test server) has no server reflection, so its descriptor
 * ships bundled here (`GRPCBIN_PROTO`) and is the fallback when a request carries
 * neither `protoContent` nor `protoPath`. Any other server must supply one of
 * those two until reflection-based discovery lands (out of scope for now).
 */

import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, isAbsolute, extname } from 'node:path'
import * as protoLoader from '@grpc/proto-loader'
import * as grpc from '@grpc/grpc-js'
import type { ServiceClientConstructor } from '@grpc/grpc-js'
import type { MethodDefinition } from '@grpc/proto-loader'

/**
 * Canonical `moul/grpcbin` descriptor (package `grpcbin`, service `GRPCBin`).
 * Field numbers + the quirky `DummyBidirectionalStreamStream` method name are
 * wire-verified against the running container, so unary / server-stream / bidi
 * echoes round-trip. Used as the fallback descriptor for grpcbin-targeted
 * requests that don't carry their own proto.
 */
export const GRPCBIN_PROTO = `syntax = "proto3";
package grpcbin;

message DummyMessage {
  string f_string = 1;
  repeated string f_strings = 2;
  enum Enum { ENUM_0 = 0; ENUM_1 = 1; ENUM_2 = 2; }
  Enum f_enum = 3;
  repeated Enum f_enums = 4;
  SubMessage f_sub = 5;
  repeated SubMessage f_subs = 6;
  bool f_bool = 7;
  repeated bool f_bools = 8;
  int32 f_int32 = 9;
  repeated int32 f_int32s = 10;
  int64 f_int64 = 11;
  repeated int64 f_int64s = 12;
  bytes f_bytes = 13;
  repeated bytes f_bytess = 14;
  float f_float = 15;
  repeated float f_floats = 16;
}
message SubMessage { string f_string = 1; }
message EmptyMessage {}
message IndexReply {
  string description = 1;
  message Endpoint { string path = 1; string description = 2; }
  repeated Endpoint endpoints = 2;
}
message SpecificErrorRequest { uint32 code = 1; string reason = 2; }
message HeadersMessage {
  message Values { repeated string values = 1; }
  map<string, Values> metadata = 1;
}
service GRPCBin {
  rpc Index (EmptyMessage) returns (IndexReply);
  rpc Empty (EmptyMessage) returns (EmptyMessage);
  rpc DummyUnary (DummyMessage) returns (DummyMessage);
  rpc DummyServerStream (DummyMessage) returns (stream DummyMessage);
  rpc DummyClientStream (stream DummyMessage) returns (DummyMessage);
  rpc DummyBidirectionalStreamStream (stream DummyMessage) returns (stream DummyMessage);
  rpc SpecificError (SpecificErrorRequest) returns (EmptyMessage);
  rpc HeadersUnary (EmptyMessage) returns (HeadersMessage);
}
`

const LOAD_OPTIONS: protoLoader.Options = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
}

/** Cache of loaded package definitions, keyed by a hash of the proto content. */
const definitionCache = new Map<string, grpc.GrpcObject>()
let tmpDir: string | undefined

function protoTempDir(): string {
  tmpDir ??= mkdtempSync(join(tmpdir(), 'restorm-grpc-'))
  return tmpDir
}

/** Materialise proto content to a temp file (cached by content hash) and load it. */
function loadFromContent(content: string): grpc.GrpcObject {
  const hash = createHash('sha1').update(content).digest('hex')
  const cached = definitionCache.get(hash)
  if (cached) return cached
  const file = join(protoTempDir(), `${hash}.proto`)
  if (!existsSync(file)) writeFileSync(file, content, 'utf8')
  const pkgDef = protoLoader.loadSync(file, LOAD_OPTIONS)
  const grpcObj = grpc.loadPackageDefinition(pkgDef)
  definitionCache.set(hash, grpcObj)
  return grpcObj
}

/**
 * Validate a renderer/IPC-supplied `protoPath` before it reaches the
 * filesystem. The path is user-chosen (the feature is "point at a
 * .proto on disk"), so we don't confine it to the project root — but we
 * DO require an absolute, normalised path to a regular `.proto` file so
 * a traversal string or a non-proto target (e.g. /etc/passwd) can't be
 * loaded and parsed as a descriptor. Returns the resolved absolute path
 * or throws a descriptive error.
 */
export function assertValidProtoPath(protoPath: string): string {
  if (!isAbsolute(protoPath)) {
    throw new Error(`gRPC protoPath must be an absolute path: "${protoPath}"`)
  }
  const resolved = resolve(protoPath)
  if (extname(resolved).toLowerCase() !== '.proto') {
    throw new Error(`gRPC protoPath must point at a .proto file: "${protoPath}"`)
  }
  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    throw new Error(`gRPC protoPath not found or not a file: "${protoPath}"`)
  }
  return resolved
}

/** Load a proto from a `.proto` file on disk. Cached by path for the process
 * lifetime (editing the file on disk won't be picked up until restart). */
function loadFromPath(path: string): grpc.GrpcObject {
  const resolved = assertValidProtoPath(path)
  const cached = definitionCache.get(`path:${resolved}`)
  if (cached) return cached
  const pkgDef = protoLoader.loadSync(resolved, LOAD_OPTIONS)
  const grpcObj = grpc.loadPackageDefinition(pkgDef)
  definitionCache.set(`path:${resolved}`, grpcObj)
  return grpcObj
}

/** Source of a request's proto descriptor (resolved by the execution service). */
export interface ProtoSource {
  /** Base64-encoded, serialized `google.protobuf.FileDescriptorSet` fetched
   * via gRPC server reflection. Takes precedence over `protoContent`/
   * `protoPath` — it's the freshest, most specific source when present (a
   * reflection refresh should win over a stale inline proto). */
  protoDescriptorSet?: string | undefined
  /** Inline proto file content. */
  protoContent?: string | undefined
  /** Path to a `.proto` file on disk. */
  protoPath?: string | undefined
}

/** Materialise a base64 `FileDescriptorSet` (cached by content hash, same
 * cache as `loadFromContent`/`loadFromPath`) via proto-loader's own decoder —
 * the same one `grpcReflectionClient.ts` uses to interpret the descriptor. */
function loadFromDescriptorSet(base64: string): grpc.GrpcObject {
  const hash = createHash('sha1').update(base64).digest('hex')
  const cached = definitionCache.get(hash)
  if (cached) return cached
  const pkgDef = protoLoader.loadFileDescriptorSetFromBuffer(Buffer.from(base64, 'base64'), LOAD_OPTIONS)
  const grpcObj = grpc.loadPackageDefinition(pkgDef)
  definitionCache.set(hash, grpcObj)
  return grpcObj
}

/**
 * Resolve a {@link ProtoSource} into the loaded gRPC package object, applying
 * the same precedence as the client path: a reflected `protoDescriptorSet`
 * first (freshest / most specific), then inline `protoContent`, then a
 * `.proto` file at `protoPath`, then the bundled grpcbin fallback. Shared by
 * the client (`resolveGrpcMethod`) and the mock SERVER (which walks every
 * service / method to build its `ServiceDefinition`s) so both parse a proto
 * identically.
 */
export function loadGrpcPackage(source: ProtoSource): grpc.GrpcObject {
  if (source.protoDescriptorSet && source.protoDescriptorSet.trim() !== '') {
    return loadFromDescriptorSet(source.protoDescriptorSet)
  }
  if (source.protoContent && source.protoContent.trim() !== '') {
    return loadFromContent(source.protoContent)
  }
  if (source.protoPath && source.protoPath.trim() !== '') {
    return loadFromPath(source.protoPath)
  }
  return loadFromContent(GRPCBIN_PROTO)
}

/** The raw definition of one service in a loaded proto: its fully-qualified
 * name + the proto-loader `ServiceDefinition` (what `grpc.Server.addService`
 * consumes), with each method's streaming flags exposed for handler wiring. */
export interface GrpcServiceDefinitionEntry {
  /** Fully-qualified service name (e.g. `grpcbin.GRPCBin`). */
  name: string
  /** The proto-loader service definition (keyed by method name). */
  definition: grpc.ServiceDefinition
  /** Per-method streaming flags (requestStream / responseStream). */
  methods: { name: string; requestStream: boolean; responseStream: boolean }[]
}

/**
 * Walk a loaded gRPC package object and collect every service's
 * `ServiceDefinition` (the `.service` member each generated constructor carries)
 * along with its fully-qualified name + per-method streaming flags. The mock
 * server registers one handler set per returned entry.
 */
export function enumerateGrpcServices(root: grpc.GrpcObject): GrpcServiceDefinitionEntry[] {
  const out: GrpcServiceDefinitionEntry[] = []
  const walk = (obj: grpc.GrpcObject, prefix: string): void => {
    for (const [key, value] of Object.entries(obj)) {
      // proto-loader runtime objects can carry null entries — widen + null-guard.
      const node: unknown = value
      const qualified = prefix ? `${prefix}.${key}` : key
      if (typeof node === 'function' && 'service' in node) {
        const definition = (node as ServiceClientConstructor).service
        const methods = Object.entries(definition).map(([methodName, def]) => ({
          name: methodName,
          requestStream: (def as MethodDefinition<object, object>).requestStream,
          responseStream: (def as MethodDefinition<object, object>).responseStream
        }))
        out.push({ name: qualified, definition, methods })
      } else if (typeof node === 'object' && node !== null && !('service' in node)) {
        walk(node as grpc.GrpcObject, qualified)
      }
    }
  }
  walk(root, '')
  return out
}

/** Walk a dotted, package-qualified service name into the loaded GrpcObject. */
function resolveServiceConstructor(root: grpc.GrpcObject, serviceName: string): ServiceClientConstructor | undefined {
  // Try the fully-qualified name first (e.g. `grpcbin.GRPCBin`), then the bare
  // service name as a fallback (some descriptors load without a package prefix).
  const candidates = [serviceName, serviceName.split('.').pop() ?? serviceName]
  for (const candidate of candidates) {
    let node: unknown = root
    for (const part of candidate.split('.')) {
      if (node && typeof node === 'object' && part in (node as Record<string, unknown>)) {
        node = (node as Record<string, unknown>)[part]
      } else {
        node = undefined
        break
      }
    }
    if (typeof node === 'function') return node as ServiceClientConstructor
  }
  // Last resort: scan every nested service for one whose bare name matches.
  const bare = serviceName.split('.').pop()
  const scan = (obj: grpc.GrpcObject): ServiceClientConstructor | undefined => {
    for (const [key, value] of Object.entries(obj)) {
      // `value` is typed non-null but proto-loader's runtime objects can carry
      // null entries, so widen to `unknown` and null-guard before `in`.
      const node: unknown = value
      if (typeof node === 'function' && 'service' in node && key === bare) {
        return node as ServiceClientConstructor
      }
      if (typeof node === 'object' && node !== null && !('service' in node)) {
        const found = scan(node as grpc.GrpcObject)
        if (found) return found
      }
    }
    return undefined
  }
  return scan(root)
}

/** A resolved gRPC method: the dynamic client + the method's streaming flags. */
export interface ResolvedGrpcMethod {
  /** Dynamic service client; invoke the call as `client[method](...)`. */
  client: grpc.Client & Record<string, (...args: unknown[]) => unknown>
  requestStream: boolean
  responseStream: boolean
  /** The gRPC path (`/package.Service/Method`) — identical to the path a
   * gRPC-Web or Connect-RPC HTTP request targets, so the HTTP-framed
   * transports address the same endpoint the native client would. */
  path: string
  /** The proto-loader's own protobuf encoder/decoder for this method's
   * request/response message types. gRPC-Web reuses these directly so its
   * binary framing carries a real protobuf payload — built from the exact
   * same descriptor as the native client — instead of needing a second
   * codec pipeline. */
  requestSerialize: (value: object) => Buffer
  responseDeserialize: (bytes: Buffer) => object
}

/**
 * Build a dynamic client for `service` at `address` and resolve `method` on it.
 * Throws a descriptive error when the proto can't be loaded or the
 * service/method isn't found (surfaced as a gRPC-shaped failure by the caller).
 */
export function resolveGrpcMethod(
  source: ProtoSource,
  address: string,
  service: string,
  method: string,
  credentials: grpc.ChannelCredentials
): ResolvedGrpcMethod {
  // Inline content → `.proto` path → bundled grpcbin fallback (loadFromPath
  // validates the path and throws a descriptive error the caller surfaces).
  const root = loadGrpcPackage(source)

  const Ctor = resolveServiceConstructor(root, service)
  if (!Ctor) {
    throw new Error(`gRPC service "${service}" not found in the proto descriptor`)
  }
  const client = new Ctor(address, credentials)
  const methodDef = (Ctor.service as Record<string, MethodDefinition<object, object>>)[method]
  if (!methodDef) {
    throw new Error(`gRPC method "${method}" not found on service "${service}"`)
  }
  return {
    client: client as ResolvedGrpcMethod['client'],
    requestStream: methodDef.requestStream,
    responseStream: methodDef.responseStream,
    path: methodDef.path,
    requestSerialize: methodDef.requestSerialize,
    responseDeserialize: methodDef.responseDeserialize
  }
}

/** Map a gRPC numeric status code to its canonical name (for display). */
export function grpcStatusName(code: number): string {
  return grpc.status[code] ?? `CODE_${code}`
}
