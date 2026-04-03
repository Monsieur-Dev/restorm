/**
 * gRPC Execution Service
 * Handles gRPC request execution in the main process
 * 
 * Note: Full gRPC support requires grpc-js library.
 * This is a placeholder that returns an UNIMPLEMENTED status.
 */

import { BrowserWindow } from 'electron'
import { logger } from 'electron-core-ui/main'
import { contextService } from './ContextService'

/** gRPC request execution input */
export interface GRPCExecutionInput {
  requestId: string
  timeout?: number
}

/** gRPC response result */
export interface GRPCExecutionResult {
  requestId: string
  success: boolean
  statusCode?: number
  statusMessage?: string
  responseMessage?: string
  metadata?: Record<string, string>
  error?: string
  timings: {
    startedAt: string
    durationMs: number
  }
  requestUrl?: string
  requestMethod?: string
}

/**
 * Service for executing gRPC requests in the main process
 * 
 * Note: This is currently a placeholder. Full implementation would require:
 * - @grpc/grpc-js for native gRPC support
 * - Proto file loading and parsing
 * - Dynamic client generation
 */
class GRPCExecutionService {
  private activeRequests = new Map<string, AbortController>()

  /**
   * Execute a gRPC request
   */
  execute(input: GRPCExecutionInput): GRPCExecutionResult {
    const { requestId } = input
    const startTime = Date.now()
    const startedAt = new Date().toISOString()

    // Get resolved URL from ContextService
    const urlResult = contextService.getResolvedUrl(requestId)
    if (!urlResult) {
      return {
        requestId,
        success: false,
        error: 'No resolved URL found for this request. Make sure the request is registered.',
        timings: { startedAt, durationMs: Date.now() - startTime }
      }
    }

    const resolvedUrl = urlResult.resolvedUrl
    logger.info('[GRPCExecutionService] Executing request', { requestId, url: resolvedUrl })

    // Get request context
    const requestContext = contextService.getRequestContext(requestId)
    
    // Create abort controller for cancellation
    const abortController = new AbortController()
    this.activeRequests.set(requestId, abortController)

    // Broadcast that request started
    this.broadcastProgress(requestId, 'started')

    try {
      const durationMs = Date.now() - startTime
      
      // Build method name from service and method
      const service = requestContext?.fullData?.service ?? ''
      const method = requestContext?.fullData?.grpcMethod ?? ''
      const fullMethod = service && method ? `${service}/${method}` : 'Unknown'
      
      // Get request message
      const requestMessage = requestContext?.fullData?.requestMessage ?? '{}'
      const resolvedMessage = contextService.resolveValue(requestMessage, requestId)
      
      // Parse message safely
      let parsedMessage: unknown = {}
      try {
        parsedMessage = JSON.parse(resolvedMessage) as unknown
      } catch (error) {
        logger.warn('[GRPCExecutionService] Failed to parse JSON metadata', { error: String(error) })
      }

      // Broadcast completion
      this.broadcastProgress(requestId, 'completed')

      // Return placeholder response indicating gRPC is not fully implemented
      return {
        requestId,
        success: false,
        statusCode: 12, // UNIMPLEMENTED
        statusMessage: 'gRPC calls require native gRPC implementation',
        responseMessage: JSON.stringify({
          note: 'gRPC support requires @grpc/grpc-js library',
          url: resolvedUrl,
          service,
          method,
          message: parsedMessage
        }, null, 2),
        error: 'gRPC not fully implemented - requires @grpc/grpc-js',
        requestUrl: resolvedUrl,
        requestMethod: fullMethod,
        timings: { startedAt, durationMs }
      }
    } catch (err) {
      const durationMs = Date.now() - startTime
      const error = err as Error
      
      // Check if cancelled
      if (abortController.signal.aborted) {
        this.broadcastProgress(requestId, 'cancelled')
        return {
          requestId,
          success: false,
          error: 'Request cancelled',
          requestUrl: resolvedUrl,
          timings: { startedAt, durationMs }
        }
      }

      this.broadcastProgress(requestId, 'error')
      
      return {
        requestId,
        success: false,
        error: error.message || 'Request failed',
        requestUrl: resolvedUrl,
        timings: { startedAt, durationMs }
      }
    } finally {
      this.activeRequests.delete(requestId)
    }
  }

  /**
   * Cancel an active request
   */
  cancel(requestId: string): boolean {
    const abortController = this.activeRequests.get(requestId)
    if (abortController) {
      logger.info('[GRPCExecutionService] Cancelling request', { requestId })
      abortController.abort()
      return true
    }
    return false
  }

  /**
   * Check if a request is currently active
   */
  isActive(requestId: string): boolean {
    return this.activeRequests.has(requestId)
  }

  /**
   * Broadcast progress to renderer
   */
  private broadcastProgress(requestId: string, status: 'started' | 'completed' | 'cancelled' | 'error'): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.send('grpc:request-progress', { requestId, status })
    }
  }
}

/** Singleton instance */
export const grpcExecutionService = new GRPCExecutionService()
