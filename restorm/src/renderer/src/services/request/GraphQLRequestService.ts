/**
 * GraphQL Request Service
 * Handles executing GraphQL requests
 */

import axios from 'axios'
import type { GraphQLRequest, GraphQLResponse, KeyValue } from '../../types/collections'
import { resolveTemplate, type VariableContext } from '../VariableResolutionService'

/** Input for executing a GraphQL request */
export interface GraphQLRequestInput {
  /** The GraphQL request definition */
  request: GraphQLRequest
  /** Current URL (may differ from request.url if user changed it) */
  url: string
  /** Current query */
  query: string
  /** Current variables (JSON string) */
  variables?: string
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

/**
 * Execute a GraphQL request and return the response
 */
export async function executeGraphQLRequest(input: GraphQLRequestInput): Promise<GraphQLResponse> {
  const startTime = Date.now()
  const startedAt = new Date().toISOString()
  
  const context = input.variableContext
  
  // Resolve URL
  const resolvedUrl = resolveTemplate(input.url, context)
  
  // Resolve headers
  const resolvedHeaders = resolveKeyValues(input.headers, context)
  const headersObj = headersToObject(resolvedHeaders)
  
  // Ensure Content-Type is set
  if (!headersObj['Content-Type']) {
    headersObj['Content-Type'] = 'application/json'
  }
  
  // Parse variables
  let variables: Record<string, unknown> = {}
  if (input.variables) {
    try {
      const resolvedVariables = resolveTemplate(input.variables, context)
      const parsed = JSON.parse(resolvedVariables) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        variables = parsed as Record<string, unknown>
      }
    } catch {
      // Invalid JSON, use empty object
    }
  }
  
  // Build GraphQL payload
  const payload = {
    query: input.query,
    variables: Object.keys(variables).length > 0 ? variables : undefined
  }
  
  try {
    const response = await axios.post(resolvedUrl, payload, {
      headers: headersObj,
      validateStatus: () => true,
      timeout: 30000
    })
    
    const durationMs = Date.now() - startTime
    
    // Parse GraphQL response
    const responseData = response.data as {
      data?: unknown
      errors?: { message: string; locations?: { line: number; column: number }[]; path?: string[] }[]
    }
    
    return {
      id: generateResponseId(),
      type: 'graphql',
      requestId: input.request.id,
      requestUrl: resolvedUrl,
      requestQuery: input.query,
      requestVariables: input.variables,
      requestHeaders: resolvedHeaders,
      statusCode: response.status,
      data: responseData.data,
      errors: responseData.errors,
      responseHeaders: objectToKeyValues(response.headers as Record<string, unknown>),
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
      type: 'graphql',
      requestId: input.request.id,
      requestUrl: resolvedUrl,
      requestQuery: input.query,
      requestVariables: input.variables,
      requestHeaders: resolvedHeaders,
      statusCode: 0,
      responseHeaders: [],
      error: error.message || 'Request failed',
      timings: {
        startedAt,
        durationMs
      }
    }
  }
}
