/**
 * GraphQL Request Service
 * Handles executing GraphQL requests
 */

import axios from 'axios'
import type { GraphQLRequest, GraphQLResponse, KeyValue } from '../../../shared/types/collections'
import { StringValue } from '../../../shared/types/collections'
import { logger } from 'electron-core-ui/main'
import type { VariableContext } from './types'
import { resolveTemplate } from './resolveTemplate'
import { resolveKeyValues, headersToObject, generateResponseId } from './keyValueResolution'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../../../shared/config/constants'

// Re-export for consumers
export type { VariableContext } from './types'

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

/** Convert object to KeyValue array */
function objectToKeyValues(obj: Record<string, unknown>): KeyValue[] {
  return Object.entries(obj).map(([key, value]) => ({
    key,
    value: new StringValue(String(value))
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
  
  // Ensure Content-Type is set — case-insensitive presence check so a
  // user header in any casing suppresses the default (no duplicate).
  if (!Object.keys(headersObj).some((k) => k.toLowerCase() === 'content-type')) {
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
    } catch (error) {
      logger.warn('[GraphQLRequestService] Failed to parse JSON metadata', { error: String(error) })
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
      timeout: DEFAULT_REQUEST_TIMEOUT_MS
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
    const error = err as Error & { code?: string; response?: { status?: number; statusText?: string } }
    
    // Build detailed error message
    let errorMessage = 'Request failed'
    if (error.message) {
      errorMessage = error.message
    }
    if (error.code) {
      errorMessage = `${errorMessage} (code: ${error.code})`
    }
    if (error.response) {
      errorMessage = `${errorMessage} (HTTP ${error.response.status}: ${error.response.statusText ?? 'Unknown'})`
    }
    
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
      error: errorMessage,
      timings: {
        startedAt,
        durationMs
      }
    }
  }
}
