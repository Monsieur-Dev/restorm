/**
 * HTTP Request Service
 * Handles building and executing HTTP requests with variable resolution
 */

import axios, { type AxiosResponse, type AxiosError, type AxiosRequestConfig } from 'axios'
import type {
  HTTPRequest,
  HTTPResponse,
  HTTPRequestBody,
  KeyValue,
  HTTPMethod
} from '../../types/collections'
// TODO: Variable resolution will be implemented in backend
export type VariableContext = Record<string, string>

/** Placeholder for variable resolution - returns template as-is (to be implemented in backend) */
function resolveTemplate(template: string, _context: VariableContext): string {
  return template
}

/** Input for URL resolution */
export interface URLResolutionInput {
  /** URL template with variables (e.g., "{{baseUrl}}/api/pet/{{petId}}") */
  urlTemplate: string
  /** Path parameters (key-value pairs, values may contain variables) */
  pathParams: KeyValue[]
  /** Query parameters (key-value pairs, values may contain variables) */
  queryParams: KeyValue[]
  /** Variable context from environments */
  environmentContext: VariableContext
}

/** Result of URL resolution */
export interface ResolvedURLResult {
  /** The final URL with all variables resolved and params encoded */
  url: string
  /** Base URL without query params (path params resolved) */
  baseUrl: string
  /** Query string (without leading ?) */
  queryString: string
}

/** Input for building and executing an HTTP request */
export interface HTTPRequestInput {
  /** The HTTP request definition */
  request: HTTPRequest
  /** Current method (may differ from request.method if user changed it) */
  method: HTTPMethod
  /** Current URL template (may differ from request.url if user changed it) */
  url: string
  /** Current headers */
  headers: KeyValue[]
  /** Current query parameters */
  params: KeyValue[]
  /** Current path parameters */
  pathParams: KeyValue[]
  /** Current body content (for text mode) */
  bodyContent?: string
  /** Current body mode */
  bodyMode: 'text' | 'form-data' | 'x-www-form-urlencoded' | 'file'
  /** Form fields (for form-data or x-www-form-urlencoded) */
  formFields?: KeyValue[]
  /** File path (for file mode) */
  filePath?: string
  /** Variable context from environments */
  variableContext: VariableContext
}

/**
 * Resolve all KeyValue pairs using the variable context
 */
function resolveKeyValues(keyValues: KeyValue[], context: VariableContext): KeyValue[] {
  return keyValues.map((kv) => ({
    key: resolveTemplate(kv.key, context),
    value: resolveTemplate(kv.value, context),
    description: kv.description
  }))
}

/**
 * Build the query string from resolved and URL-encoded parameters
 */
function buildQueryString(params: KeyValue[]): string {
  const parts: string[] = []
  for (const param of params) {
    if (param.key) {
      parts.push(`${encodeURIComponent(param.key)}=${encodeURIComponent(param.value)}`)
    }
  }
  return parts.join('&')
}

/**
 * Resolve the complete URL with all variables substituted and params URL-encoded.
 * This is the main function for URL resolution - use it for both tooltip display and HTTP calls.
 *
 * @param input - URL resolution parameters
 * @returns Resolved URL result with full URL, base URL, and query string
 */
export function resolveRequestURL(input: URLResolutionInput): ResolvedURLResult {
  // Step 1: Resolve path params values using environment context
  const pathParamsContext: VariableContext = {}
  for (const pp of input.pathParams) {
    const resolvedKey = resolveTemplate(pp.key, input.environmentContext)
    const resolvedValue = resolveTemplate(pp.value, input.environmentContext)
    if (resolvedKey) {
      // URL-encode path param values
      pathParamsContext[resolvedKey] = encodeURIComponent(resolvedValue)
    }
  }

  // Step 2: Build full context (environment + path params)
  const fullContext: VariableContext = {
    ...input.environmentContext,
    ...pathParamsContext
  }

  // Step 3: Resolve the URL template with full context
  const baseUrl = resolveTemplate(input.urlTemplate, fullContext)

  // Step 4: Resolve query params and build URL-encoded query string
  const resolvedQueryParams = resolveKeyValues(input.queryParams, input.environmentContext)
  const queryString = buildQueryString(resolvedQueryParams)

  // Step 5: Combine base URL and query string
  const url = queryString ? `${baseUrl}?${queryString}` : baseUrl

  return {
    url,
    baseUrl,
    queryString
  }
}

/**
 * Generate a unique ID for the response
 */
function generateResponseId(): string {
  return `resp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Convert axios headers to KeyValue array
 */
function headersToKeyValues(headers: Record<string, unknown>): KeyValue[] {
  const result: KeyValue[] = []
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined && value !== null) {
      result.push({
        key,
        value: typeof value === 'string' ? value : JSON.stringify(value)
      })
    }
  }
  return result
}

/**
 * Build request body based on body mode
 */
function buildRequestBody(
  input: HTTPRequestInput,
  context: VariableContext
): { data: unknown; contentType?: string } {
  switch (input.bodyMode) {
    case 'text': {
      const content = input.bodyContent ?? ''
      const resolvedContent = resolveTemplate(content, context)
      return { data: resolvedContent }
    }

    case 'form-data': {
      const formData = new FormData()
      const fields = input.formFields ?? []
      for (const field of fields) {
        const key = resolveTemplate(field.key, context)
        const value = resolveTemplate(field.value, context)
        if (key) {
          formData.append(key, value)
        }
      }
      return { data: formData, contentType: 'multipart/form-data' }
    }

    case 'x-www-form-urlencoded': {
      const params = new URLSearchParams()
      const fields = input.formFields ?? []
      for (const field of fields) {
        const key = resolveTemplate(field.key, context)
        const value = resolveTemplate(field.value, context)
        if (key) {
          params.append(key, value)
        }
      }
      return { data: params.toString(), contentType: 'application/x-www-form-urlencoded' }
    }

    case 'file': {
      // File handling would need IPC for Electron
      // For now, return empty - file reading should be handled separately
      return { data: undefined }
    }

    default:
      return { data: undefined }
  }
}

/**
 * Execute an HTTP request and return the response
 */
export async function executeHTTPRequest(input: HTTPRequestInput): Promise<HTTPResponse> {
  const startTime = Date.now()
  const startedAt = new Date().toISOString()

  const context = input.variableContext

  // Build URL using the centralized resolution function
  const urlResult = resolveRequestURL({
    urlTemplate: input.url,
    pathParams: input.pathParams,
    queryParams: input.params,
    environmentContext: context
  })

  // Resolve headers
  const resolvedHeaders = resolveKeyValues(input.headers, context)
  const headersObj: Record<string, string> = {}
  for (const h of resolvedHeaders) {
    if (h.key) {
      headersObj[h.key] = h.value
    }
  }

  // Build body
  const { data, contentType } = buildRequestBody(input, context)
  if (contentType && !headersObj['Content-Type']) {
    headersObj['Content-Type'] = contentType
  }

  // Build request body for storage
  let requestBody: HTTPRequestBody | undefined
  switch (input.bodyMode) {
    case 'text':
      requestBody = { type: 'text', content: input.bodyContent ?? '' }
      break
    case 'form-data':
      requestBody = { type: 'form-data', fields: input.formFields ?? [] }
      break
    case 'x-www-form-urlencoded':
      requestBody = { type: 'x-www-form-urlencoded', fields: input.formFields ?? [] }
      break
    case 'file':
      requestBody = { type: 'file', path: input.filePath ?? '' }
      break
  }

  const config: AxiosRequestConfig = {
    method: input.method.toLowerCase(),
    url: urlResult.url,
    headers: headersObj,
    data,
    // Return response for all status codes
    validateStatus: () => true,
    // Get response as text to preserve original format
    responseType: 'text',
    // Include timing info
    timeout: 30000
  }

  try {
    const response: AxiosResponse = await axios(config)
    const durationMs = Date.now() - startTime

    // Parse response body
    let responseBody = ''
    if (response.data !== undefined && response.data !== null) {
      responseBody = typeof response.data === 'string' ? response.data : JSON.stringify(response.data)
    }

    // Get content info from headers
    const contentTypeHeader = response.headers['content-type'] as string | undefined
    const contentLengthHeader = response.headers['content-length'] as string | undefined
    const contentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : undefined

    const parsedContentLength = contentLength !== undefined && !isNaN(contentLength) ? contentLength : undefined

    return {
      id: generateResponseId(),
      type: 'http',
      requestId: input.request.id,
      requestUrl: urlResult.url,
      requestMethod: input.method,
      requestHeaders: resolvedHeaders,
      requestParams: resolveKeyValues(input.params, context),
      requestPathParams: resolveKeyValues(input.pathParams, input.variableContext),
      requestBody,
      statusCode: response.status,
      statusText: response.statusText,
      responseHeaders: headersToKeyValues(response.headers),
      responseBody,
      ...(contentTypeHeader !== undefined && { contentType: contentTypeHeader }),
      ...(parsedContentLength !== undefined && { contentLength: parsedContentLength }),
      timings: {
        startedAt,
        durationMs
      }
    }
  } catch (err) {
    const durationMs = Date.now() - startTime
    const axiosError = err as AxiosError

    // Handle network errors
    return {
      id: generateResponseId(),
      type: 'http',
      requestId: input.request.id,
      requestUrl: urlResult.url,
      requestMethod: input.method,
      requestHeaders: resolvedHeaders,
      requestParams: resolveKeyValues(input.params, context),
      requestPathParams: resolveKeyValues(input.pathParams, input.variableContext),
      requestBody,
      statusCode: 0,
      statusText: 'Network Error',
      responseHeaders: [],
      responseBody: '',
      error: axiosError.message || 'Request failed',
      timings: {
        startedAt,
        durationMs
      }
    }
  }
}
