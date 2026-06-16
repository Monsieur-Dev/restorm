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
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

/** Load a proto from a `.proto` file on disk. Cached by path for the process
 * lifetime (editing the file on disk won't be picked up until restart). */
function loadFromPath(path: string): grpc.GrpcObject {
  const cached = definitionCache.get(`path:${path}`)
  if (cached) return cached
  const pkgDef = protoLoader.loadSync(path, LOAD_OPTIONS)
  const grpcObj = grpc.loadPackageDefinition(pkgDef)
  definitionCache.set(`path:${path}`, grpcObj)
  return grpcObj
}

/** Source of a request's proto descriptor (resolved by the execution service). */
export interface ProtoSource {
  /** Inline proto file content. */
  protoContent?: string | undefined
  /** Path to a `.proto` file on disk. */
  protoPath?: string | undefined
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
  let root: grpc.GrpcObject
  if (source.protoContent && source.protoContent.trim() !== '') {
    root = loadFromContent(source.protoContent)
  } else if (source.protoPath && existsSync(source.protoPath)) {
    root = loadFromPath(source.protoPath)
  } else {
    root = loadFromContent(GRPCBIN_PROTO)
  }

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
    responseStream: methodDef.responseStream
  }
}

/** Map a gRPC numeric status code to its canonical name (for display). */
export function grpcStatusName(code: number): string {
  return grpc.status[code] ?? `CODE_${code}`
}
