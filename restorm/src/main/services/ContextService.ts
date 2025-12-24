/**
 * ContextService - Manages Handlebars context and resolved values (Main Process)
 *
 * Listens to document events from the EventBus and maintains:
 * - Data objects needed for Handlebars resolution
 * - Resolved variable values per environment
 *
 * Runs in the main process to avoid blocking the UI.
 */

import { BrowserWindow } from 'electron'
import Handlebars from 'handlebars'
import {
  eventBusService,
  type Subscription,
  logger
} from 'electron-core-ui/main'
import {
  DocumentEvents,
  type DocumentChangedPayload,
  type DocumentDeletedPayload
} from './DocumentEvents'

/** KeyValue structure from environment */
interface KeyValue {
  id?: string
  key: string
  value: string
  description?: string
}

/** Environment structure */
interface Environment {
  id?: string
  name: string
  variables: KeyValue[]
  subEnvironments?: Environment[]
}

/** Stored environment metadata */
interface EnvironmentMeta {
  /** Parent environment ID (null for root environments) */
  parentEnvironmentId: string | null
  /** Child environment IDs */
  childIds: Set<string>
  /** Raw variables from the environment */
  rawVariables: KeyValue[]
}

/** Transformed context type */
type TransformedContext = Record<string, string>

/** Result of a variable transformation */
interface VariableTransformResult {
  /** Copy of the context used for transformation */
  contextUsed: TransformedContext
  /** The transformed value */
  transformedValue: string
  /** Original raw value before transformation */
  rawValue: string
  /** The key name */
  key: string
}

/** Request context tracking */
interface RequestContext {
  /** Selected environment ID (null if no environment) */
  environmentId: string | null
  /** Request KeyValues to transform (headers, params, pathParams, etc.) */
  keyValueGroups: Map<string, KeyValue[]>
}

/** Request structure (minimal for context service) */
interface RequestData {
  id: string
  headers?: KeyValue[]
  params?: KeyValue[]
  pathParams?: KeyValue[]
  // Add other fields as needed (body fields, etc.)
}

/**
 * ContextService class - manages Handlebars context (Main Process)
 */
class ContextService {
  private subscriptions: Subscription[] = []
  private initialized = false

  /** Map of environmentId -> metadata */
  private environmentMeta = new Map<string, EnvironmentMeta>()

  /** Map of environmentId -> transformed context */
  private transformedContexts = new Map<string, TransformedContext>()

  /** Map of variableId (runtime id) -> transformation result */
  private variableTransformResults = new Map<string, VariableTransformResult>()

  /** Map of requestId -> request context (selected env + keyvalue groups) */
  private requestContexts = new Map<string, RequestContext>()

  /**
   * Initialize the service and start listening to events
   */
  initialize(): void {
    if (this.initialized) {
      return
    }

    logger.info('[ContextService] Initializing...')

    // Subscribe to environment events
    this.subscriptions.push(
      eventBusService.subscribe<DocumentChangedPayload>(DocumentEvents.ENVIRONMENT_CREATED, (payload) => {
        this.handleEnvironmentCreated(payload)
      })
    )

    this.subscriptions.push(
      eventBusService.subscribe<DocumentChangedPayload>(DocumentEvents.ENVIRONMENT_UPDATED, (payload) => {
        this.handleEnvironmentUpdated(payload)
      })
    )

    this.subscriptions.push(
      eventBusService.subscribe<DocumentDeletedPayload>(DocumentEvents.ENVIRONMENT_DELETED, (payload) => {
        this.handleEnvironmentDeleted(payload)
      })
    )

    this.initialized = true
    logger.info('[ContextService] Initialized - listening to environment events')
  }

  /**
   * Handle environment created event
   */
  private handleEnvironmentCreated(payload: DocumentChangedPayload): void {
    const envId = payload.id
    const parentEnvId = payload.parentEnvironmentId ?? null
    const env = payload.document as Environment

    logger.info('[ContextService] ENVIRONMENT_CREATED', {
      id: envId,
      name: env.name,
      parentEnvironmentId: parentEnvId,
      variablesCount: env.variables.length
    })

    // Store metadata
    this.environmentMeta.set(envId, {
      parentEnvironmentId: parentEnvId,
      childIds: new Set(),
      rawVariables: env.variables
    })

    // Register this environment as child of parent
    if (parentEnvId) {
      const parentMeta = this.environmentMeta.get(parentEnvId)
      if (parentMeta) {
        parentMeta.childIds.add(envId)
      }
    }

    // Calculate and store transformed context
    this.recalculateContext(envId)
  }

  /**
   * Handle environment updated event
   */
  private handleEnvironmentUpdated(payload: DocumentChangedPayload): void {
    const envId = payload.id
    const env = payload.document as Environment

    logger.info('[ContextService] ENVIRONMENT_UPDATED', {
      id: envId,
      name: env.name,
      variablesCount: env.variables.length
    })

    const meta = this.environmentMeta.get(envId)
    if (meta) {
      // Update raw variables
      meta.rawVariables = env.variables

      // Recalculate context for this env and all descendants
      this.recalculateContextCascade(envId)
    }
  }

  /**
   * Handle environment deleted event
   */
  private handleEnvironmentDeleted(payload: DocumentDeletedPayload): void {
    const envId = payload.id

    logger.info('[ContextService] ENVIRONMENT_DELETED', { id: envId })

    // Delete this environment and all descendants recursively
    this.deleteEnvironmentCascade(envId)
  }

  /**
   * Delete an environment and all its descendants from the maps
   */
  private deleteEnvironmentCascade(envId: string): void {
    const meta = this.environmentMeta.get(envId)
    if (!meta) {
      return
    }

    // First, recursively delete all children
    for (const childId of meta.childIds) {
      this.deleteEnvironmentCascade(childId)
    }

    // Remove from parent's childIds
    if (meta.parentEnvironmentId) {
      const parentMeta = this.environmentMeta.get(meta.parentEnvironmentId)
      if (parentMeta) {
        parentMeta.childIds.delete(envId)
      }
    }

    // Remove variable transform results for this environment's variables
    for (const kv of meta.rawVariables) {
      if (kv.id) {
        this.variableTransformResults.delete(kv.id)
      }
    }

    // Remove from maps
    this.environmentMeta.delete(envId)
    this.transformedContexts.delete(envId)

    logger.debug('[ContextService] Deleted environment from context', { id: envId })
  }

  /**
   * Recalculate context for an environment and all its descendants
   */
  private recalculateContextCascade(envId: string): void {
    this.recalculateContext(envId)

    const meta = this.environmentMeta.get(envId)
    if (meta) {
      for (const childId of meta.childIds) {
        this.recalculateContextCascade(childId)
      }
    }

    // Also recalculate requests using this environment or its descendants
    this.recalculateRequestsUsingEnvironment(envId)
  }

  /**
   * Calculate transformed context for a single environment
   * by accumulating parent contexts and applying Handlebars
   */
  private recalculateContext(envId: string): void {
    const meta = this.environmentMeta.get(envId)
    if (!meta) {
      return
    }

    // Build accumulated context from parent chain
    let accumulatedContext: TransformedContext = {}

    // Get parent chain (from root to direct parent)
    const parentChain = this.getParentChain(envId)

    // Accumulate contexts from parents
    for (const parentId of parentChain) {
      const parentContext = this.transformedContexts.get(parentId)
      if (parentContext) {
        accumulatedContext = { ...accumulatedContext, ...parentContext }
      }
    }

    // Now apply this environment's variables with Handlebars transformation
    const finalContext = { ...accumulatedContext }

    for (const kv of meta.rawVariables) {
      if (kv.key) {
        // Copy context before transformation for this variable
        const contextUsed = { ...finalContext }
        const transformedValue = this.transformValue(kv.value, finalContext)
        finalContext[kv.key] = transformedValue

        // Store and broadcast transformation result if variable has an id
        if (kv.id) {
          this.storeAndBroadcastTransformResult(kv.id, {
            contextUsed,
            transformedValue,
            rawValue: kv.value,
            key: kv.key
          })
        }
      }
    }

    // Store the result
    this.transformedContexts.set(envId, finalContext)

    logger.debug('[ContextService] Calculated context', {
      id: envId,
      contextKeys: Object.keys(finalContext),
      variableResultsCount: meta.rawVariables.filter(kv => kv.id).length
    })
  }

  /**
   * Get parent chain from root to direct parent (excluding self)
   */
  private getParentChain(envId: string): string[] {
    const chain: string[] = []
    let currentId: string | null = envId

    // First, collect parents from direct parent to root
    const meta = this.environmentMeta.get(currentId)
    if (!meta) {
      return chain
    }

    currentId = meta.parentEnvironmentId

    while (currentId) {
      chain.unshift(currentId) // Add to beginning
      const parentMeta = this.environmentMeta.get(currentId)
      if (!parentMeta) {
        break
      }
      currentId = parentMeta.parentEnvironmentId
    }

    return chain
  }

  /**
   * Transform a value using Handlebars
   */
  private transformValue(value: string, context: TransformedContext): string {
    if (!value.includes('{{')) {
      return value
    }

    try {
      const template = Handlebars.compile(value, { noEscape: true })
      return template(context)
    } catch (error) {
      logger.warn('[ContextService] Handlebars transform error', {
        value,
        error: String(error)
      })
      return value
    }
  }

  /**
   * Store a transformation result and broadcast it to the renderer
   */
  private storeAndBroadcastTransformResult(variableId: string, result: VariableTransformResult): void {
    this.variableTransformResults.set(variableId, result)
    this.broadcastToRenderer('context:variable-transformed', {
      variableId,
      ...result
    })
  }

  /**
   * Broadcast a message to all renderer windows
   */
  private broadcastToRenderer(channel: string, payload: unknown): void {
    const windows = BrowserWindow.getAllWindows()
    for (const window of windows) {
      if (!window.isDestroyed()) {
        window.webContents.send(channel, payload)
      }
    }
  }

  /**
   * Get the transformed context for an environment
   */
  getContext(envId: string): TransformedContext | undefined {
    return this.transformedContexts.get(envId)
  }

  /**
   * Get the transformation result for a variable by its runtime id
   */
  getVariableTransformResult(variableId: string): VariableTransformResult | undefined {
    return this.variableTransformResults.get(variableId)
  }

  /**
   * Get all variable transformation results as a plain object (for IPC)
   */
  getAllVariableTransformResults(): Record<string, VariableTransformResult> {
    const result: Record<string, VariableTransformResult> = {}
    for (const [key, value] of this.variableTransformResults) {
      result[key] = value
    }
    return result
  }

  // =========================================================================
  // Request Context Management
  // =========================================================================

  /**
   * Register a request for context tracking.
   * Called when a request tab is opened.
   */
  registerRequest(requestId: string, environmentId: string | null, requestData: RequestData): void {
    logger.info('[ContextService] Registering request', { requestId, environmentId })

    const keyValueGroups = new Map<string, KeyValue[]>()
    if (requestData.headers) keyValueGroups.set('headers', requestData.headers)
    if (requestData.params) keyValueGroups.set('params', requestData.params)
    if (requestData.pathParams) keyValueGroups.set('pathParams', requestData.pathParams)

    this.requestContexts.set(requestId, {
      environmentId,
      keyValueGroups
    })

    // Calculate transformations for all KeyValue groups
    this.recalculateRequestContext(requestId)
  }

  /**
   * Unregister a request from context tracking.
   * Called when a request tab is closed.
   */
  unregisterRequest(requestId: string): void {
    logger.info('[ContextService] Unregistering request', { requestId })

    const ctx = this.requestContexts.get(requestId)
    if (ctx) {
      // Remove all variable transform results for this request's KeyValues
      for (const keyValues of ctx.keyValueGroups.values()) {
        for (const kv of keyValues) {
          if (kv.id) {
            this.variableTransformResults.delete(kv.id)
          }
        }
      }
    }

    this.requestContexts.delete(requestId)
  }

  /**
   * Update the selected environment for a request.
   * Called when the environment dropdown changes.
   */
  setRequestEnvironment(requestId: string, environmentId: string | null): void {
    const ctx = this.requestContexts.get(requestId)
    if (!ctx) {
      logger.warn('[ContextService] setRequestEnvironment: request not registered', { requestId })
      return
    }

    logger.info('[ContextService] Setting request environment', { requestId, environmentId })
    ctx.environmentId = environmentId
    this.recalculateRequestContext(requestId)
  }

  /**
   * Update a KeyValue group for a request (e.g., headers, params).
   * Called when the user modifies headers/params/etc in the UI.
   */
  updateRequestKeyValues(requestId: string, groupName: string, keyValues: KeyValue[]): void {
    const ctx = this.requestContexts.get(requestId)
    if (!ctx) {
      logger.warn('[ContextService] updateRequestKeyValues: request not registered', { requestId })
      return
    }

    // Remove old transform results for the group
    const oldKeyValues = ctx.keyValueGroups.get(groupName)
    if (oldKeyValues) {
      for (const kv of oldKeyValues) {
        if (kv.id) {
          this.variableTransformResults.delete(kv.id)
        }
      }
    }

    ctx.keyValueGroups.set(groupName, keyValues)
    this.recalculateRequestContext(requestId)
  }

  /**
   * Recalculate all KeyValue transformations for a request
   */
  private recalculateRequestContext(requestId: string): void {
    const ctx = this.requestContexts.get(requestId)
    if (!ctx) return

    // Get the base context from the selected environment
    let baseContext: TransformedContext = {}
    if (ctx.environmentId) {
      const envContext = this.transformedContexts.get(ctx.environmentId)
      if (envContext) {
        baseContext = { ...envContext }
      }
    }

    logger.debug('[ContextService] Recalculating request context', {
      requestId,
      environmentId: ctx.environmentId,
      baseContextKeys: Object.keys(baseContext),
      groups: Array.from(ctx.keyValueGroups.keys())
    })

    // Process each KeyValue group
    for (const [groupName, keyValues] of ctx.keyValueGroups) {
      // For each group, accumulate context as we process variables
      const groupContext = { ...baseContext }

      for (const kv of keyValues) {
        if (kv.key) {
          const contextUsed = { ...groupContext }
          const transformedValue = this.transformValue(kv.value, groupContext)
          groupContext[kv.key] = transformedValue

          if (kv.id) {
            this.storeAndBroadcastTransformResult(kv.id, {
              contextUsed,
              transformedValue,
              rawValue: kv.value,
              key: kv.key
            })
          }
        }
      }

      logger.debug('[ContextService] Processed request group', {
        requestId,
        groupName,
        variableCount: keyValues.filter(kv => kv.id).length
      })
    }
  }

  /**
   * Recalculate all requests that use a specific environment
   * Called when an environment is updated
   */
  private recalculateRequestsUsingEnvironment(environmentId: string): void {
    // Also check if any request uses a descendant environment
    const affectedEnvIds = new Set<string>([environmentId])

    // Collect all descendant environment IDs
    const collectDescendants = (envId: string): void => {
      const meta = this.environmentMeta.get(envId)
      if (meta) {
        for (const childId of meta.childIds) {
          affectedEnvIds.add(childId)
          collectDescendants(childId)
        }
      }
    }
    collectDescendants(environmentId)

    // Recalculate all requests using affected environments
    for (const [requestId, ctx] of this.requestContexts) {
      if (ctx.environmentId && affectedEnvIds.has(ctx.environmentId)) {
        logger.debug('[ContextService] Recalculating request due to environment change', {
          requestId,
          environmentId: ctx.environmentId
        })
        this.recalculateRequestContext(requestId)
      }
    }
  }

  /**
   * Destroy the service and unsubscribe from events
   */
  destroy(): void {
    logger.info('[ContextService] Destroying...')
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe()
    }
    this.subscriptions = []
    this.environmentMeta.clear()
    this.transformedContexts.clear()
    this.variableTransformResults.clear()
    this.requestContexts.clear()
    this.initialized = false
  }
}

/** Singleton instance */
export const contextService = new ContextService()
