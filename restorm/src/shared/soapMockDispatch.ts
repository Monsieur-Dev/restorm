/**
 * SOAP mock dispatch — the PURE core of restorm's hosted SOAP server.
 *
 * The HTTP transport (port host, route registration, request/response plumbing)
 * is shared with the HTTP mock server; this module owns only the SOAP
 * specialization: picking the operation an inbound request targets and
 * serializing the matching response as a SOAP XML envelope (incl. `<soap:Fault>`).
 * Kept dependency-free + side-effect-free so it unit-tests as a pure function.
 */

import type { SoapMockOperation } from './types/requests/SoapRequest'

/** The SOAP 1.1 envelope + body namespace. */
const SOAP_ENV_NS = 'http://schemas.xmlsoap.org/soap/envelope/'

/** Resolve which mock operation an inbound request targets.
 *
 * Dispatch precedence mirrors the SOAP spec: a non-empty `SOAPAction` header
 * wins (it is the explicit routing key); otherwise the request is routed by the
 * local name of the first child element under `<soap:Body>`. Returns `undefined`
 * when nothing matches (the caller answers a fault).
 */
export function resolveSoapOperation(
  operations: SoapMockOperation[] | undefined,
  inbound: { soapAction?: string | undefined; body: string }
): SoapMockOperation | undefined {
  if (!operations || operations.length === 0) return undefined

  // 1. SOAPAction header (quotes + whitespace stripped — clients send "urn:Add").
  const action = normalizeSoapAction(inbound.soapAction)
  if (action) {
    const byAction = operations.find(op => normalizeSoapAction(op.soapAction) === action)
    if (byAction) return byAction
  }

  // 2. First child element under <soap:Body>.
  const bodyOp = firstBodyOperationName(inbound.body)
  if (bodyOp) {
    const byName = operations.find(op => op.name === bodyOp)
    if (byName) return byName
  }

  return undefined
}

/** Strip the surrounding quotes + whitespace a `SOAPAction` header carries
 * (`"urn:Add"` → `urn:Add`); empty / absent → undefined. */
export function normalizeSoapAction(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  const trimmed = raw.trim().replace(/^"(.*)"$/, '$1').trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** Extract the LOCAL name (namespace prefix stripped) of the first child element
 * under the SOAP `<Body>`. A light scan — no XML-parser dependency — robust to
 * namespace prefixes, attributes, and an absent Body. Returns undefined when no
 * operation element is found. */
export function firstBodyOperationName(xml: string): string | undefined {
  if (!xml) return undefined
  // Locate the Body open tag (any/no namespace prefix), then the first element
  // start tag after it.
  const bodyOpen = /<\s*(?:[\w.-]+:)?Body[\s>]/i.exec(xml)
  const scanFrom = bodyOpen ? bodyOpen.index + bodyOpen[0].length : 0
  const rest = xml.slice(scanFrom).replace(/<!--[\s\S]*?-->/g, '')
  // First child element: skip whitespace, capture the (possibly NS-prefixed) tag
  // name. The name char class includes `:` so a prefixed tag (`tns:Add`) is
  // captured whole, then the prefix is stripped below.
  const child = /<\s*([\w.:-]+)(?:[\s/>]|$)/.exec(rest)
  if (!child) return undefined
  const tag = child[1]
  if (/^\/?(?:[\w.-]+:)?Body$/i.test(tag) || /^\/?(?:[\w.-]+:)?Envelope$/i.test(tag)) return undefined
  const colon = tag.indexOf(':')
  return colon >= 0 ? tag.slice(colon + 1) : tag
}

/** Whether `xml` already carries a full SOAP `<Envelope>` (so we serve it
 * verbatim rather than wrapping it again). */
function isFullEnvelope(xml: string): boolean {
  return /<\s*(?:[\w.-]+:)?Envelope[\s>]/i.test(xml)
}

/** Build the SOAP envelope a hosted mock serves for a resolved operation.
 *
 * - A `responseBody` that is already a full `<Envelope>` is returned verbatim.
 * - An `isFault` operation is wrapped in `<soap:Fault>` (its `responseBody` is
 *   the inner fault content, or — for a bare string — used as the faultstring).
 * - Otherwise the `responseBody` is the inner `<Body>` content, wrapped in a
 *   SOAP 1.1 envelope.
 *
 * Returns the XML string + the HTTP status the transport should answer with
 * (`500` for a fault, `200` otherwise).
 */
export function buildSoapResponse(op: SoapMockOperation): { status: number; xml: string } {
  if (op.isFault) {
    return { status: 500, xml: wrapEnvelope(buildFaultBody(op.responseBody)) }
  }
  const inner = op.responseBody
  if (isFullEnvelope(inner)) return { status: 200, xml: inner }
  return { status: 200, xml: wrapEnvelope(inner) }
}

/** Build the inner `<soap:Fault>` content. When `responseBody` already contains
 * a `<Fault>` element it is used as-is; a bare string becomes the faultstring of
 * a minimal SOAP 1.1 fault. */
function buildFaultBody(responseBody: string): string {
  const content = responseBody
  if (/<\s*(?:[\w.-]+:)?Fault[\s>]/i.test(content)) return content
  const message = content.trim().length > 0 ? content.trim() : 'Server error'
  return `<soap:Fault><faultcode>soap:Server</faultcode><faultstring>${escapeXml(message)}</faultstring></soap:Fault>`
}

/** Wrap inner `<Body>` content in a SOAP 1.1 envelope. */
function wrapEnvelope(innerBody: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>`
    + `<soap:Envelope xmlns:soap="${SOAP_ENV_NS}">`
    + `<soap:Body>${innerBody}</soap:Body>`
    + `</soap:Envelope>`
}

/** The fault a mock answers when no operation matches the inbound request. */
export function buildUnmatchedFault(operationName: string | undefined): { status: number; xml: string } {
  const detail = operationName
    ? `No mock operation matches '${operationName}'`
    : 'No mock operation matches the request'
  return {
    status: 500,
    xml: wrapEnvelope(`<soap:Fault><faultcode>soap:Client</faultcode><faultstring>${escapeXml(detail)}</faultstring></soap:Fault>`)
  }
}

/** Minimal XML text escaping for values we interpolate into the envelope. */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
