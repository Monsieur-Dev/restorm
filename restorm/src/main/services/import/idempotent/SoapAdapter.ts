import type {
  AdapterOptions,
  GenericOperationShape,
  ImportAdapter,
  NormalizedModel,
  NormalizedOperation,
  NormalizedSpec
} from './types'

/**
 * SOAP / WSDL exposes `portType` operations indexed by SOAP action.
 * The pipeline normalises one operation per `portType` × operation
 * pair; `naturalKey` is `${portTypeName}/${operationName}` (the
 * portType being the closest equivalent of an interface).
 *
 * The existing `SoapImportService` already parses the WSDL into a
 * structured tree of `services + ports + operations + messages`
 * + `types` schemas. This adapter consumes that tree.
 */
interface SoapOperationLike {
  name: string
  soapAction?: string
  inputMessage?: string
  outputMessage?: string
  documentation?: string
  deprecated?: boolean
}

interface SoapPortTypeLike {
  name: string
  operations?: SoapOperationLike[]
}

interface SoapTypeLike {
  name: string
  description?: string
  deprecated?: boolean
  fields?: { name: string; type: string; required?: boolean; deprecated?: boolean }[]
}

interface SoapSpecLike {
  targetNamespace?: string
  portTypes?: SoapPortTypeLike[]
  types?: SoapTypeLike[]
  version?: string
}

export const soapImportAdapter: ImportAdapter = {
  format: 'wsdl',
  extractNormalizedSpec(rawSpec: unknown, _options: AdapterOptions): NormalizedSpec {
    const spec = rawSpec as SoapSpecLike
    const operations: NormalizedOperation[] = []
    for (const portType of spec.portTypes ?? []) {
      for (const op of portType.operations ?? []) {
        const shape: GenericOperationShape = {
          protocol: 'soap',
          raw: {
            portType: portType.name,
            operation: op.name,
            ...(op.soapAction !== undefined ? { soapAction: op.soapAction } : {}),
            ...(op.inputMessage !== undefined ? { inputMessage: op.inputMessage } : {}),
            ...(op.outputMessage !== undefined ? { outputMessage: op.outputMessage } : {})
          }
        }
        operations.push({
          naturalKey: `${portType.name}/${op.name}`,
          name: op.name,
          deprecated: op.deprecated === true,
          shape,
          ...(op.soapAction !== undefined ? { operationId: op.soapAction } : {})
        })
      }
    }
    const models: NormalizedModel[] = (spec.types ?? []).map((t) => ({
      name: t.name,
      ...(t.description !== undefined ? { description: t.description } : {}),
      deprecated: t.deprecated === true,
      properties: (t.fields ?? []).map((f) => ({
        name: f.name,
        type: f.type,
        required: f.required === true,
        deprecated: f.deprecated === true
      }))
    }))
    return {
      ...(spec.version !== undefined ? { version: spec.version } : {}),
      operations,
      models,
      enums: [],
      environments: []
    }
  }
}
