/**
 * SOAP projection of an API design.
 *
 * Every design route becomes a document-style SOAP operation (named
 * after its operationId), grouped under ONE service named after the
 * design. The generated WSDL 1.1 carries the service, its port (bound
 * to the served address), the binding (SOAP 1.1 over HTTP, one
 * soapAction per operation) and the portType (operation names +
 * documentation) — exactly the surface the app's own WSDL importer
 * reads back. Calls are dispatched by `SOAPAction` header first, then
 * by the body's root element, and answered with the bound response
 * model's instance serialized as an XML payload — same serving kernel
 * as every other projection.
 */

import type { ApiDesign, DesignModel, DesignRoute, DesignRouteGroup } from '../types/apiDesign'
import { buildModelInstance } from './designServing'
import { operationVerb } from '../utils/httpMethod'

// ── Names ─────────────────────────────────────────────────────────────

/** Sanitize to an XML NCName-ish token (letters, digits, `_`). */
function sanitizeXmlName(raw: string, fallback: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
  const named = cleaned === '' ? fallback : cleaned
  return /^[0-9]/.test(named) ? `_${named}` : named
}

function upperFirst(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/** The service name the design projects into. */
export function designSoapServiceName(design: ApiDesign): string {
  return `${sanitizeXmlName(design.info.title !== '' ? design.info.title : design.name, 'Design')}Service`
}

/** The WSDL/SOAP target namespace. */
export function designSoapNamespace(design: ApiDesign): string {
  return `urn:restorm:design:${sanitizeXmlName(design.info.title !== '' ? design.info.title : design.name, 'design').toLowerCase()}`
}

export interface SoapOperation {
  /** Operation name, e.g. `ListUsers`. */
  name: string
  soapAction: string
  route: DesignRoute
  /** The group the route lives in (its auth contract applies). */
  group: DesignRouteGroup
  /** Bound success-response model (absent = empty ack payload). */
  model?: DesignModel
  /** Whether the response is a list of instances. */
  list: boolean
  documentation?: string
}

/** Derive the SOAP operations — one per route, collision-free. */
export function designSoapOperations(design: ApiDesign): SoapOperation[] {
  const namespace = designSoapNamespace(design)
  const taken = new Set<string>()
  const operations: SoapOperation[] = []
  for (const group of design.routeGroups) {
    for (const route of group.routes) {
      const method = (route.doc.match.method ?? 'GET').toUpperCase()

      const responses = route.design?.responses ?? {}
      const codes = Object.keys(responses).filter((code) => code.startsWith('2')).sort()
      const meta = codes[0] !== undefined ? responses[codes[0]] : undefined
      const model = meta?.modelId !== undefined
        ? design.models.find((m) => m.id === meta.modelId)
        : undefined
      const list = meta?.list === true

      // Method-driven name (like GraphQL): an explicit operationId wins, else a
      // bound model gives `${verb}${Model}` so the WSDL operation tracks the HTTP
      // method instead of freezing a stale summary; a model-less route keeps its
      // summary / method+path.
      const seed = route.doc.operationId
        ?? (model !== undefined
          ? `${operationVerb(method, list)}${sanitizeXmlName(model.doc.name, 'Operation')}`
          : route.doc.summary ?? `${upperFirst(method.toLowerCase())}${sanitizeXmlName(route.doc.match.urlPattern, 'Route')}`)
      const base = upperFirst(sanitizeXmlName(seed, 'Operation'))
      let name = base
      let n = 2
      while (taken.has(name)) { name = `${base}${n}`; n += 1 }
      taken.add(name)

      const operation: SoapOperation = {
        name,
        soapAction: `${namespace}#${name}`,
        route,
        group,
        list
      }
      if (model !== undefined) operation.model = model
      if (route.doc.summary !== undefined && route.doc.summary !== '') operation.documentation = route.doc.summary
      operations.push(operation)
    }
  }
  return operations
}

// ── WSDL emission ─────────────────────────────────────────────────────

function xmlEscape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Emit the design's WSDL 1.1. `address` is the served SOAP endpoint
 * (e.g. `http://localhost:4820/soap`); the export surface passes the
 * design's configured port.
 */
export function designToWsdl(design: ApiDesign, address: string): string {
  const namespace = designSoapNamespace(design)
  const serviceName = designSoapServiceName(design)
  const operations = designSoapOperations(design)
  const portTypeName = `${serviceName}PortType`
  const bindingName = `${serviceName}Binding`
  const lines: string[] = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"',
    '                  xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"',
    '                  xmlns:xsd="http://www.w3.org/2001/XMLSchema"',
    `                  xmlns:tns="${xmlEscape(namespace)}"`,
    `                  targetNamespace="${xmlEscape(namespace)}">`
  ]

  // Messages: one request/response pair per operation.
  for (const operation of operations) {
    lines.push(
      `  <wsdl:message name="${operation.name}Request">`,
      `    <wsdl:part name="parameters" element="tns:${operation.name}" />`,
      '  </wsdl:message>',
      `  <wsdl:message name="${operation.name}Response">`,
      `    <wsdl:part name="parameters" element="tns:${operation.name}Response" />`,
      '  </wsdl:message>'
    )
  }

  lines.push(`  <wsdl:portType name="${portTypeName}">`)
  for (const operation of operations) {
    lines.push(`    <wsdl:operation name="${operation.name}">`)
    if (operation.documentation !== undefined) {
      lines.push(`      <wsdl:documentation>${xmlEscape(operation.documentation)}</wsdl:documentation>`)
    }
    lines.push(
      `      <wsdl:input message="tns:${operation.name}Request" />`,
      `      <wsdl:output message="tns:${operation.name}Response" />`,
      '    </wsdl:operation>'
    )
  }
  lines.push('  </wsdl:portType>')

  lines.push(
    `  <wsdl:binding name="${bindingName}" type="tns:${portTypeName}">`,
    '    <soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http" />'
  )
  for (const operation of operations) {
    lines.push(
      `    <wsdl:operation name="${operation.name}">`,
      `      <soap:operation soapAction="${xmlEscape(operation.soapAction)}" />`,
      '      <wsdl:input><soap:body use="literal" /></wsdl:input>',
      '      <wsdl:output><soap:body use="literal" /></wsdl:output>',
      '    </wsdl:operation>'
    )
  }
  lines.push('  </wsdl:binding>')

  lines.push(
    `  <wsdl:service name="${serviceName}">`,
    design.info.description !== undefined && design.info.description !== ''
      ? `    <wsdl:documentation>${xmlEscape(design.info.description)}</wsdl:documentation>`
      : `    <wsdl:documentation>${xmlEscape(design.info.title !== '' ? design.info.title : design.name)}</wsdl:documentation>`,
    `    <wsdl:port name="${serviceName}Port" binding="tns:${bindingName}">`,
    `      <soap:address location="${xmlEscape(address)}" />`,
    '    </wsdl:port>',
    '  </wsdl:service>',
    '</wsdl:definitions>',
    ''
  )
  return lines.join('\n')
}

// ── Serving ───────────────────────────────────────────────────────────

/** Dispatch an inbound call: `SOAPAction` header first (quotes and
 * whitespace tolerated), the body's root element name second. */
export function matchSoapOperation(
  operations: SoapOperation[],
  soapActionHeader: string | undefined,
  bodyRootName: string | undefined
): SoapOperation | undefined {
  const action = soapActionHeader?.trim().replace(/^"(.*)"$/, '$1')
  if (action !== undefined && action !== '') {
    const byAction = operations.find((op) => op.soapAction === action || op.name === action)
    if (byAction !== undefined) return byAction
  }
  if (bodyRootName !== undefined) {
    const local = bodyRootName.split(':').pop() ?? bodyRootName
    return operations.find((op) => op.name === local || `${op.name}Request` === local)
  }
  return undefined
}

/** Serialize one served value as an XML element tree (one nesting
 * level of objects, arrays as repeated `<item>`). */
function xmlValue(name: string, value: unknown, indent: string): string[] {
  const tag = sanitizeXmlName(name, 'value')
  if (value === null || value === undefined) return [`${indent}<${tag} />`]
  if (Array.isArray(value)) {
    const lines: string[] = [`${indent}<${tag}>`]
    for (const item of value) lines.push(...xmlValue('item', item, `${indent}  `))
    lines.push(`${indent}</${tag}>`)
    return lines
  }
  if (typeof value === 'object') {
    const lines: string[] = [`${indent}<${tag}>`]
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      lines.push(...xmlValue(key, child, `${indent}  `))
    }
    lines.push(`${indent}</${tag}>`)
    return lines
  }
  // Only primitives reach this point (null/array/object are handled above).
  return [`${indent}<${tag}>${xmlEscape(String(value as string | number | boolean))}</${tag}>`]
}

/** Build the response envelope for an operation: the bound model's
 * instance(s) under `<opResponse>`, an empty ack otherwise. */
export function buildSoapResponseEnvelope(design: ApiDesign, operation: SoapOperation): string {
  const namespace = designSoapNamespace(design)
  const payload: string[] = []
  if (operation.model !== undefined) {
    if (operation.list) {
      for (let i = 0; i < 3; i++) {
        const named = (operation.model.examples ?? [])[i]
        const instance = named !== undefined
          ? buildModelInstance(design, operation.model, { exampleId: named.id, seedKey: `soap:${i}` })
          : buildModelInstance(design, operation.model, { seedKey: `soap:${i}` })
        payload.push(...xmlValue(operation.model.doc.name, instance, '      '))
      }
    } else {
      const exampleId = (operation.model.examples ?? [])[0]?.id
      const instance = exampleId !== undefined
        ? buildModelInstance(design, operation.model, { exampleId, seedKey: 'soap:single' })
        : buildModelInstance(design, operation.model, { seedKey: 'soap:single' })
      payload.push(...xmlValue(operation.model.doc.name, instance, '      '))
    }
  }
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">',
    '  <soap:Body>',
    `    <${operation.name}Response xmlns="${xmlEscape(namespace)}">`,
    ...payload,
    `    </${operation.name}Response>`,
    '  </soap:Body>',
    '</soap:Envelope>',
    ''
  ].join('\n')
}

/** The fault an unmatched call answers with (HTTP 500 at the shell). */
export function buildSoapFaultEnvelope(detail: string): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">',
    '  <soap:Body>',
    '    <soap:Fault>',
    '      <faultcode>soap:Client</faultcode>',
    `      <faultstring>${xmlEscape(detail)}</faultstring>`,
    '    </soap:Fault>',
    '  </soap:Body>',
    '</soap:Envelope>',
    ''
  ].join('\n')
}
