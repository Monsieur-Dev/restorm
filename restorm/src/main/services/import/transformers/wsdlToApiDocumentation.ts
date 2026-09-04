/**
 * WSDL / SOAP → ApiDocumentation transformer.
 *
 * The SoapImportService parses the WSDL XML into a minimal ParsedWsdl structure
 * (services, portTypes, bindings). Here we read that same structure and produce the
 * common ApiDocumentation format, one operation per (service × binding operation).
 */

import type {
  ApiDocumentation,
  GroupDocumentation,
  OperationDocumentation
} from '../../../../shared/types/apiDocumentation'

// ---------- WSDL source-spec types (shape mirrors SoapImportService) ----------

export interface WsdlOperationData {
  name: string
  documentation?: string | undefined
  soapAction: string
  input?: string | undefined
  output?: string | undefined
  deprecated?: boolean | undefined
}

export interface WsdlPortTypeData {
  name: string
  operations: WsdlOperationData[]
}

export interface WsdlBindingData {
  name: string
  portType: string
  operations: WsdlOperationData[]
}

export interface WsdlServiceData {
  name: string
  documentation?: string | undefined
  ports: { name: string; binding: string; address: string }[]
}

export interface ParsedWsdlData {
  targetNamespace: string
  services: WsdlServiceData[]
  portTypes: WsdlPortTypeData[]
  bindings: WsdlBindingData[]
}

export interface WsdlTransformOptions {
  /** Fallback API title when the WSDL has no service name. */
  name?: string
  /** Fallback server host when no service port has an address. */
  baseUrl?: string
  /** Original URL the WSDL was fetched from. */
  sourceUrl?: string
}

// ---------- Helpers ----------

function pickPortTypeDoc(portTypes: WsdlPortTypeData[], opName: string): string | undefined {
  for (const pt of portTypes) {
    const match = pt.operations.find((op) => op.name === opName)
    if (match?.documentation !== undefined && match.documentation.length > 0) return match.documentation
  }
  return undefined
}

/** True when the operation is flagged deprecated in any portType — the binding
 *  operations carry no such flag, so the deprecation rides on the portType side
 *  (see soapProjection's `deprecated="true"` attribute). */
function pickPortTypeDeprecated(portTypes: WsdlPortTypeData[], opName: string): boolean {
  return portTypes.some((pt) => pt.operations.some((op) => op.name === opName && op.deprecated === true))
}

function findBinding(bindings: WsdlBindingData[], portBinding: string): WsdlBindingData | undefined {
  // port.binding may be prefixed (e.g., tns:MyBinding) — compare on local part.
  const local = portBinding.split(':').pop() ?? portBinding
  return bindings.find((b) => b.name === local)
}

// ---------- Entry point ----------

export function wsdlToApiDocumentation(
  parsed: ParsedWsdlData,
  options: WsdlTransformOptions = {}
): ApiDocumentation {
  const firstService = parsed.services[0]
  const title = firstService?.name ?? options.name ?? 'SOAP Service'

  const groups: Record<string, GroupDocumentation> = {}
  const operations: OperationDocumentation[] = []
  let serverHost: string | undefined

  for (const service of parsed.services) {
    const group: GroupDocumentation = { name: service.name }
    if (service.documentation !== undefined) group.description = service.documentation
    groups[service.name] = group

    const port = service.ports[0]
    const address = port?.address ?? options.baseUrl
    if (address && !serverHost) serverHost = address

    if (!port) continue
    const binding = findBinding(parsed.bindings, port.binding)
    if (!binding) continue

    for (const op of binding.operations) {
      const doc: OperationDocumentation = {
        match: {
          urlPattern: address ?? '',
          soapAction: op.soapAction,
          operationName: op.name,
          serviceName: service.name
        },
        group: service.name,
        summary: op.name,
        operationId: op.name
      }
      const description = op.documentation ?? pickPortTypeDoc(parsed.portTypes, op.name)
      if (description !== undefined) doc.description = description
      if (pickPortTypeDeprecated(parsed.portTypes, op.name)) doc.deprecated = true
      operations.push(doc)
    }
  }

  const result: ApiDocumentation = {
    sourceType: 'wsdl',
    api: {
      title,
      description: 'SOAP Web Service'
    },
    models: {},
    groups,
    operations
  }

  if (options.sourceUrl !== undefined) result.sourceUrl = options.sourceUrl

  if (parsed.targetNamespace !== '' || serverHost !== undefined) {
    result.server = {}
    if (parsed.targetNamespace !== '') result.server.namespace = parsed.targetNamespace
    if (serverHost !== undefined) result.server.host = serverHost
  }

  return result
}
