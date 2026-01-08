/**
 * Request Service Wrappers - Renderer Side
 * These wrappers call the main process via IPC for request operations
 */

import type {
  URLResolutionInput,
  ResolvedURLResult
} from '../../../../main/services/request/HTTPRequestService'

/**
 * Resolve HTTP request URL with variables and parameters
 * @param input URL resolution input
 * @returns Resolved URL result
 */
export function resolveRequestURL(input: URLResolutionInput): Promise<ResolvedURLResult> {
  if (!window.restorm) {
    throw new Error('[resolveRequestURL] window.restorm not available')
  }
  const restorm = window.restorm as typeof window.restorm & {
    request: { resolveURL: (input: URLResolutionInput) => Promise<ResolvedURLResult> }
  }
  return restorm.request.resolveURL(input)
}

// Re-export types for convenience
export type { URLResolutionInput, ResolvedURLResult }
export * from '../../types/collections'
