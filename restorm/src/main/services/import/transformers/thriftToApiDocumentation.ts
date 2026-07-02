/**
 * Thrift IDL → ApiDocumentation transformer.
 *
 * Thrift services speak their own binary wire protocol, not HTTP, so there is
 * no route to materialise as an executable request — every operation here is
 * flagged `extra.documentationOnly` and carries no `match.urlPattern`.
 */

import type {
  ApiDocumentation,
  GroupDocumentation,
  ModelDocumentation,
  OperationDocumentation,
  ParameterDocumentation,
  PropertyDocumentation
} from '../../../../shared/types/apiDocumentation'

// ---------- Thrift source-spec types (mirror ThriftImportService) ----------

export interface ThriftFieldData {
  name: string
  type: string
  required: boolean
}

export interface ThriftStructData {
  name: string
  fields: ThriftFieldData[]
}

export interface ThriftMethodData {
  name: string
  args: ThriftFieldData[]
  returnType: string
  oneway: boolean
}

export interface ThriftServiceData {
  name: string
  methods: ThriftMethodData[]
}

export interface ParsedThriftData {
  namespace: string
  services: ThriftServiceData[]
  structs: ThriftStructData[]
}

export interface ThriftTransformOptions {
  /** Fallback API title when the IDL declares no namespace. */
  name?: string
  /** Original URL/path the IDL was fetched from. */
  sourceUrl?: string
}

// ---------- Helpers ----------

function mapStructsToModels(structs: ThriftStructData[]): Record<string, ModelDocumentation> {
  const out: Record<string, ModelDocumentation> = {}
  for (const struct of structs) {
    const properties: PropertyDocumentation[] = struct.fields.map((f) => ({
      name: f.name,
      type: f.type,
      required: f.required
    }))
    out[struct.name] = { name: struct.name, properties }
  }
  return out
}

// ---------- Entry point ----------

export function thriftToApiDocumentation(
  parsed: ParsedThriftData,
  options: ThriftTransformOptions = {}
): ApiDocumentation {
  const title = parsed.namespace !== '' ? parsed.namespace : options.name ?? 'Thrift API'
  const structNames = new Set(parsed.structs.map((s) => s.name))

  const groups: Record<string, GroupDocumentation> = {}
  const operations: OperationDocumentation[] = []

  for (const service of parsed.services) {
    groups[service.name] = { name: service.name }

    for (const method of service.methods) {
      const parameters: ParameterDocumentation[] = method.args.map((a) => ({
        name: a.name,
        location: 'argument',
        type: a.type,
        required: a.required
      }))

      const doc: OperationDocumentation = {
        match: {
          urlPattern: '',
          operationName: method.name,
          serviceName: service.name
        },
        group: service.name,
        summary: method.name,
        operationId: method.name,
        extra: { documentationOnly: true, oneway: method.oneway, returnType: method.returnType }
      }
      if (parameters.length > 0) doc.parameters = parameters
      const refs = [...method.args.map((a) => a.type), method.returnType].filter((t) => structNames.has(t))
      if (refs.length > 0) doc.referencedModels = Array.from(new Set(refs))
      operations.push(doc)
    }
  }

  const result: ApiDocumentation = {
    sourceType: 'thrift',
    api: {
      title,
      description: 'Thrift service definition — documentation only, execution is not supported yet.'
    },
    models: mapStructsToModels(parsed.structs),
    groups,
    operations
  }

  if (options.sourceUrl !== undefined) result.sourceUrl = options.sourceUrl

  return result
}
