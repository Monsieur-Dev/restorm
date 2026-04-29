import type {
  AdapterOptions,
  GenericOperationShape,
  ImportAdapter,
  NormalizedModel,
  NormalizedOperation,
  NormalizedSpec
} from './types'

/**
 * gRPC `.proto` files declare `service`s with `rpc` methods. The
 * existing `GrpcImportService` parses the proto via protobuf.js and
 * exposes a structured tree of services + methods + message types.
 * This adapter consumes that tree.
 *
 * `naturalKey` is `${service}/${method}` — the canonical
 * fully-qualified path that gRPC servers use for routing.
 */
interface GrpcMessageLike {
  name: string
  description?: string
  deprecated?: boolean
  fields?: { name: string; type: string; required?: boolean; deprecated?: boolean; description?: string }[]
}

interface GrpcMethodLike {
  name: string
  inputType?: string
  outputType?: string
  clientStreaming?: boolean
  serverStreaming?: boolean
  deprecated?: boolean
}

interface GrpcServiceLike {
  name: string
  methods?: GrpcMethodLike[]
}

interface GrpcSpecLike {
  package?: string
  services?: GrpcServiceLike[]
  messages?: GrpcMessageLike[]
}

export const grpcImportAdapter: ImportAdapter = {
  format: 'grpc',
  extractNormalizedSpec(rawSpec: unknown, _options: AdapterOptions): NormalizedSpec {
    const spec = rawSpec as GrpcSpecLike
    const operations: NormalizedOperation[] = []
    for (const service of spec.services ?? []) {
      for (const method of service.methods ?? []) {
        const fullName = spec.package ? `${spec.package}.${service.name}/${method.name}` : `${service.name}/${method.name}`
        const shape: GenericOperationShape = {
          protocol: 'grpc',
          raw: {
            service: service.name,
            method: method.name,
            ...(method.inputType !== undefined ? { inputType: method.inputType } : {}),
            ...(method.outputType !== undefined ? { outputType: method.outputType } : {}),
            ...(method.clientStreaming === true ? { clientStreaming: true } : {}),
            ...(method.serverStreaming === true ? { serverStreaming: true } : {})
          }
        }
        operations.push({
          naturalKey: fullName,
          name: method.name,
          deprecated: method.deprecated === true,
          shape
        })
      }
    }
    const models: NormalizedModel[] = (spec.messages ?? []).map((m) => ({
      name: m.name,
      ...(m.description !== undefined ? { description: m.description } : {}),
      deprecated: m.deprecated === true,
      properties: (m.fields ?? []).map((f) => ({
        name: f.name,
        type: f.type,
        required: f.required === true,
        ...(f.description !== undefined ? { description: f.description } : {}),
        deprecated: f.deprecated === true
      }))
    }))
    return {
      operations,
      models,
      enums: [],
      environments: []
    }
  }
}
