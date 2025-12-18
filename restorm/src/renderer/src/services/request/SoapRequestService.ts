/**
 * SOAP Request Service
 * Handles executing SOAP requests
 */

import axios from 'axios'
import type { SoapRequest, SoapResponse, KeyValue } from '../../types/collections'
import { resolveTemplate, type VariableContext } from '../VariableResolutionService'

/** Input for executing a SOAP request */
export interface SoapRequestInput {
  /** The SOAP request definition */
  request: SoapRequest
  /** Current URL */
  url: string
  /** Current SOAP action */
  soapAction: string
  /** Current body (XML) */
  body: string
  /** Current headers */
  headers: KeyValue[]
  /** Variable context from environments */
  variableContext: VariableContext
}

/** Generate a unique ID for the response */
function generateResponseId(): string {
  return `resp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

/** Resolve KeyValue pairs with variable context */
function resolveKeyValues(keyValues: KeyValue[], context: VariableContext): KeyValue[] {
  return keyValues.map((kv) => ({
    key: resolveTemplate(kv.key, context),
    value: resolveTemplate(kv.value, context),
    description: kv.description
  }))
}

/** Convert headers to object */
function headersToObject(headers: KeyValue[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const h of headers) {
    if (h.key) {
      result[h.key] = h.value
    }
  }
  return result
}

/** Convert object to KeyValue array */
function objectToKeyValues(obj: Record<string, unknown>): KeyValue[] {
  return Object.entries(obj).map(([key, value]) => ({
    key,
    value: String(value)
  }))
}

/** Parse SOAP fault from response */
function parseSoapFault(xml: string): { code: string; message: string } | undefined {
  const faultMatch = xml.match(/<(?:\w+:)?Fault[^>]*>([\s\S]*?)<\/(?:\w+:)?Fault>/i)
  if (!faultMatch?.[1]) return undefined
  
  const faultContent = faultMatch[1]
  
  const codeMatch = faultContent.match(/<(?:\w+:)?faultcode[^>]*>([\s\S]*?)<\/(?:\w+:)?faultcode>/i)
  const messageMatch = faultContent.match(/<(?:\w+:)?faultstring[^>]*>([\s\S]*?)<\/(?:\w+:)?faultstring>/i)
  
  return {
    code: codeMatch?.[1]?.trim() ?? 'Unknown',
    message: messageMatch?.[1]?.trim() ?? 'Unknown error'
  }
}

/**
 * Execute a SOAP request and return the response
 */
export async function executeSoapRequest(input: SoapRequestInput): Promise<SoapResponse> {
  const startTime = Date.now()
  const startedAt = new Date().toISOString()
  
  const context = input.variableContext
  
  // Resolve URL and body
  const resolvedUrl = resolveTemplate(input.url, context)
  const resolvedBody = resolveTemplate(input.body, context)
  const resolvedSoapAction = resolveTemplate(input.soapAction, context)
  
  // Resolve headers
  const resolvedHeaders = resolveKeyValues(input.headers, context)
  const headersObj = headersToObject(resolvedHeaders)
  
  // Ensure Content-Type and SOAPAction are set
  if (!headersObj['Content-Type']) {
    headersObj['Content-Type'] = 'text/xml; charset=utf-8'
  }
  if (resolvedSoapAction && !headersObj['SOAPAction']) {
    headersObj['SOAPAction'] = resolvedSoapAction
  }
  
  try {
    const response = await axios.post(resolvedUrl, resolvedBody, {
      headers: headersObj,
      validateStatus: () => true,
      responseType: 'text',
      timeout: 30000
    })
    
    const durationMs = Date.now() - startTime
    const responseBody = typeof response.data === 'string' ? response.data : String(response.data)
    
    // Check for SOAP fault
    const fault = parseSoapFault(responseBody)
    
    return {
      id: generateResponseId(),
      type: 'soap',
      requestId: input.request.id,
      requestUrl: resolvedUrl,
      requestSoapAction: resolvedSoapAction,
      requestBody: resolvedBody,
      requestHeaders: resolvedHeaders,
      statusCode: response.status,
      responseBody,
      responseHeaders: objectToKeyValues(response.headers as Record<string, unknown>),
      fault,
      timings: {
        startedAt,
        durationMs
      }
    }
  } catch (err) {
    const durationMs = Date.now() - startTime
    const error = err as Error
    
    return {
      id: generateResponseId(),
      type: 'soap',
      requestId: input.request.id,
      requestUrl: resolvedUrl,
      requestSoapAction: resolvedSoapAction,
      requestBody: resolvedBody,
      requestHeaders: resolvedHeaders,
      statusCode: 0,
      responseBody: '',
      responseHeaders: [],
      error: error.message || 'Request failed',
      timings: {
        startedAt,
        durationMs
      }
    }
  }
}
