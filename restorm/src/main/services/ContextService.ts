/**
 * ContextService - Manages Handlebars context, URL resolution and code snippets (Main Process)
 *
 * Listens to document events from the EventBus and maintains:
 * - Data objects needed for Handlebars resolution
 * - Resolved variable values per environment
 * - Resolved URLs for each request
 * - Generated code snippets for each request
 *
 * URL resolution is delegated to URLResolver.
 * Code snippet generation is delegated to CodeSnippetGenerator.
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
import { registerHandlebarsHelpers } from '../utils/handlebarsHelpers'
import { pubsub, PUBSUB_TOPICS } from './CollectionStore'
import { KeyValue as KeyValueModel } from '../../shared/models'
import { ExpressionValue } from '../../shared/types/collections'
import { resolveUrl } from './URLResolver'
import { compileSnippetTemplates, generateCodeSnippets, type CompiledSnippetTemplates } from './CodeSnippetGenerator'
import type {
  KeyValue,
  Environment,
  EnvironmentMeta,
  TransformedContext,
  VariableTransformResult,
  FullRequestData,
  ResolvedUrlResult,
  CodeSnippetsResult,
  RequestContext,
  RequestData
} from './ContextServiceTypes'

// Re-export public types so existing imports from './ContextService' keep working
export type { FullRequestData, ResolvedUrlResult, CodeSnippetsResult } from './ContextServiceTypes'

function normalizeKeyValues(values: unknown[]): KeyValue[] {
  return values.map((v) => KeyValueModel.fromPlain(v as Record<string, unknown>))
}

/**
 * ContextService class - manages Handlebars context, URLs and code snippets (Main Process)
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

  /** Map of requestId -> request context (selected env + keyvalue groups + full data) */
  private requestContexts = new Map<string, RequestContext>()

  /** Map of requestId -> resolved URL result */
  private resolvedUrls = new Map<string, ResolvedUrlResult>()

  /** Map of requestId -> generated code snippets */
  private codeSnippets = new Map<string, CodeSnippetsResult>()

  /** Compiled Handlebars templates for code snippets */
  private snippetTemplates: CompiledSnippetTemplates = {
    httpSnippetTemplate: null,
    graphqlSnippetTemplate: null,
    websocketSnippetTemplate: null,
    grpcSnippetTemplate: null,
    soapSnippetTemplate: null
  }

  /**
   * Initialize the service and start listening to events
   */
  initialize(): void {
    if (this.initialized) {
      return
    }

    logger.info('[ContextService] Initializing...')

    // Register Handlebars helpers before compiling templates
    registerHandlebarsHelpers()

    // Load and compile code snippet templates from files
    this.snippetTemplates = compileSnippetTemplates()

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
    env.variables = normalizeKeyValues(env.variables as unknown as unknown[])

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

    // If a request tab was opened before this environment was processed,
    // we must recalculate those requests now that the context exists.
    this.recalculateRequestsUsingEnvironment(envId)
  }

  /**
   * Handle environment updated event
   */
  private handleEnvironmentUpdated(payload: DocumentChangedPayload): void {
    const envId = payload.id
    const env = payload.document as Environment
    env.variables = normalizeKeyValues(env.variables as unknown as unknown[])

    env.variables = normalizeKeyValues(env.variables as unknown as unknown[])

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

    // logger.debug('[ContextService] Deleted environment from context', { id: envId })
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
      // Broadcast available variables for autocompletion (for ALL fields, including disabled)
      // Each field sees: parent env variables + previous ENABLED variables in this env
      if (kv.id) {
        const varsForThisField = Object.entries(finalContext).map(([name, value]) => ({
          name,
          value
        }))
        this.broadcastFieldVariables(kv.id, varsForThisField)
      }

      // Skip disabled variables for context accumulation (enabled defaults to true if undefined)
      if (kv.enabled === false) {
        continue
      }
      if (kv.key) {
        // Copy context before transformation for this variable
        const contextUsed = { ...finalContext }
        const transformedValue = this.resolveKeyValue(kv, finalContext)
        finalContext[kv.key] = transformedValue

        // Store and broadcast transformation result if variable has an id
        if (kv.id) {
          const rawValue = kv.value.toString()
          this.storeAndBroadcastTransformResult(kv.id, {
            contextUsed,
            transformedValue,
            rawValue,
            key: kv.key
          })
        }
      }
    }

    // Second pass: re-resolve all ExpressionValues with the complete context.
    // This allows an Expression defined in a parent env to reference variables
    // that are overridden by a child env (e.g. baseUrl in root uses scheme
    // that is overridden by sub-envs http/https).
    for (const kv of meta.rawVariables) {
      if (kv.enabled === false) continue
      if (kv.key && this.isExpressionValue(kv.value)) {
        const raw = kv.value.toString()
        const reResolved = this.transformValue(raw, finalContext)
        if (reResolved !== finalContext[kv.key]) {
          finalContext[kv.key] = reResolved
          if (kv.id) {
            this.storeAndBroadcastTransformResult(kv.id, {
              contextUsed: { ...finalContext },
              transformedValue: reResolved,
              rawValue: raw,
              key: kv.key
            })
          }
        }
      }
    }

    // Also re-resolve inherited parent ExpressionValues that may depend
    // on variables overridden by this environment.
    for (const parentId of parentChain) {
      const parentMeta = this.environmentMeta.get(parentId)
      if (!parentMeta) continue
      for (const kv of parentMeta.rawVariables) {
        if (kv.enabled === false) continue
        if (kv.key && this.isExpressionValue(kv.value)) {
          const raw = kv.value.toString()
          const reResolved = this.transformValue(raw, finalContext)
          if (reResolved !== finalContext[kv.key]) {
            finalContext[kv.key] = reResolved
          }
        }
      }
    }

    // Store the result
    this.transformedContexts.set(envId, finalContext)

    // Publish context change to GraphQL subscribers
    this.publishContextChanged(envId, finalContext)
  }

  /**
   * Publish context change to GraphQL subscribers
   */
  private publishContextChanged(environmentId: string, context: TransformedContext): void {
    const variables = Object.entries(context).map(([key, value]) => ({
      key,
      value,
      resolved: value
    }))

    pubsub.publish(PUBSUB_TOPICS.CONTEXT_CHANGED, environmentId, {
      environmentId,
      variables
    })

    // Broadcast to renderer for UI components (e.g. environment config panel)
    this.broadcastToRenderer('context:environment-context-changed', {
      environmentId,
      context
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
   * Transform a value using Handlebars. Always resolves — gating on
   * `ExpressionValue` happens in `resolveKeyValue` so the URL-field
   * template resolution path (which operates on a plain string field,
   * not a typed `KeyValue`) stays intact.
   */
  private transformValue(value: string, context: TransformedContext): string {
    const rawValue = value
    if (!rawValue.includes('{{')) {
      return rawValue
    }

    try {
      const template = Handlebars.compile(rawValue, { noEscape: true })
      return template(context)
    } catch (error) {
      logger.warn('[ContextService] Handlebars transform error', {
        value: rawValue,
        error: String(error)
      })
      return rawValue
    }
  }

  /**
   * Resolve a `KeyValue`'s value. Only `ExpressionValue`s are run
   * through Handlebars — every other type is taken literally, so a
   * `StringValue("{{unresolved}}")` stays as-is. This is the rule the
   * product asked for: variable substitution is opt-in, the user marks
   * a variable as "expression" when they want templating.
   */
  private resolveKeyValue(kv: KeyValue, context: TransformedContext): string {
    const raw = kv.value.toString()
    if (this.isExpressionValue(kv.value)) {
      return this.transformValue(raw, context)
    }
    return raw
  }

  /**
   * Check if a value is an ExpressionValue. Uses instanceof first,
   * then falls back to checking the `.type` property for reactive proxy
   * objects that lose their prototype chain.
   */
  private isExpressionValue(value: unknown): boolean {
    if (value instanceof ExpressionValue) return true
    if (value && typeof value === 'object' && 'type' in value) {
      return (value as { type: string }).type === 'expression'
    }
    return false
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
      keyValueGroups,
      fullData: null
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
    this.resolvedUrls.delete(requestId)
    this.codeSnippets.delete(requestId)
  }

  /**
   * Update full request data for URL resolution and code snippet generation.
   * Called when request properties change (url, body, headers, etc.)
   */
  updateFullRequestData(requestId: string, data: FullRequestData, sourceId?: string): void {
    const ctx = this.requestContexts.get(requestId)
    if (!ctx) {
      logger.warn('[ContextService] updateFullRequestData: request not registered', { requestId })
      return
    }

    ctx.fullData = data

    // Also update keyValueGroups from full data
    if (data.headers.length > 0) ctx.keyValueGroups.set('headers', data.headers)
    if (data.params && data.params.length > 0) ctx.keyValueGroups.set('params', data.params)
    if (data.pathParams && data.pathParams.length > 0) ctx.keyValueGroups.set('pathParams', data.pathParams)
    if (data.metadata && data.metadata.length > 0) ctx.keyValueGroups.set('metadata', data.metadata)

    // Recalculate everything; sourceId echoed in broadcasts so the originating renderer can ignore its own echo
    this.recalculateRequestContext(requestId, sourceId)
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
  private recalculateRequestContext(requestId: string, sourceId?: string): void {
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

    // logger.debug('[ContextService] Recalculating request context', {
    //   requestId,
    //   environmentId: ctx.environmentId,
    //   baseContextKeys: Object.keys(baseContext),
    //   groups: Array.from(ctx.keyValueGroups.keys())
    // })

    // Process each KeyValue group
    for (const [_groupName, keyValues] of ctx.keyValueGroups) {
      // For each group, accumulate context as we process variables
      const groupContext = { ...baseContext }

      for (const kv of keyValues) {
        // Skip disabled variables (enabled defaults to true if undefined)
        if (kv.enabled === false) {
          continue
        }
        if (kv.key) {
          const contextUsed = { ...groupContext }
          const transformedValue = this.resolveKeyValue(kv, groupContext)
          groupContext[kv.key] = transformedValue

          if (kv.id) {
            const rawValue = kv.value.toString()
            this.storeAndBroadcastTransformResult(kv.id, {
              contextUsed,
              transformedValue,
              rawValue,
              key: kv.key
            })
          }
        }
      }

      // logger.debug('[ContextService] Processed request group', {
      //   requestId,
      //   groupName,
      //   variableCount: keyValues.filter(kv => kv.id && kv.enabled !== false).length
      // })
    }

    // Calculate resolved URL and code snippets if we have full data
    if (ctx.fullData) {
      // Sync fullData with keyValueGroups to ensure we use the latest values
      const headersFromGroup = ctx.keyValueGroups.get('headers')
      const paramsFromGroup = ctx.keyValueGroups.get('params')
      const pathParamsFromGroup = ctx.keyValueGroups.get('pathParams')

      const updatedData: FullRequestData = {
        ...ctx.fullData,
        headers: headersFromGroup ?? ctx.fullData.headers,
        ...(paramsFromGroup !== undefined ? { params: paramsFromGroup } : ctx.fullData.params !== undefined ? { params: ctx.fullData.params } : {}),
        ...(pathParamsFromGroup !== undefined ? { pathParams: pathParamsFromGroup } : ctx.fullData.pathParams !== undefined ? { pathParams: ctx.fullData.pathParams } : {})
      }

      // Delegate URL resolution to URLResolver
      const urlResult = resolveUrl(updatedData, baseContext, this.transformValue.bind(this))
      const previousUrlResult = this.resolvedUrls.get(requestId)
      if (previousUrlResult?.resolvedUrl !== urlResult.resolvedUrl) {
        this.resolvedUrls.set(requestId, urlResult)
        this.broadcastToRenderer('context:url-resolved', { requestId, ...urlResult, sourceId })
      }

      // Delegate code snippet generation to CodeSnippetGenerator
      const snippetResult = generateCodeSnippets(
        updatedData,
        baseContext,
        this.resolvedUrls.get(requestId),
        this.snippetTemplates,
        this.transformValue.bind(this)
      )
      const previousSnippetResult = this.codeSnippets.get(requestId)
      if (previousSnippetResult?.markdown !== snippetResult.markdown) {
        this.codeSnippets.set(requestId, snippetResult)
        this.broadcastToRenderer('context:code-snippets-updated', { requestId, ...snippetResult, sourceId })
      }

      this.calculateAvailableVariables(requestId, updatedData, baseContext, sourceId)
    }
  }

  // =========================================================================
  // Available Variables for Autocompletion
  // =========================================================================

  /** Store for available variables per variableId (each field has its own context) */
  private availableVariablesPerField = new Map<string, { name: string; value: string }[]>()

  /**
   * Calculate available variables for autocompletion
   * - URL field: env + all path params
   * - Each path param value field: env + previous path params only
   * - Each header value field: env + previous headers only
   * - Each param value field: env + previous params only
   */
  private calculateAvailableVariables(
    requestId: string,
    data: FullRequestData,
    envContext: TransformedContext,
    sourceId?: string
  ): void {
    // Base environment variables
    const envVars: { name: string; value: string }[] = []
    for (const [name, value] of Object.entries(envContext)) {
      envVars.push({ name, value })
    }

    // Helper to add or replace a variable in cumulative array
    const addOrReplace = (
      arr: { name: string; value: string }[],
      name: string,
      value: string
    ): void => {
      const existingIndex = arr.findIndex(v => v.name === name)
      if (existingIndex >= 0) {
        arr[existingIndex] = { name, value }
      } else {
        arr.push({ name, value })
      }
    }

    // Calculate for path params
    const pathParams = data.pathParams ?? []
    const cumulativePathParams: { name: string; value: string }[] = []

    for (const pp of pathParams) {
      // Skip disabled path params (enabled defaults to true if undefined)
      if (pp.enabled === false) {
        continue
      }

      if (pp.id) {
        const varsForThisField = [...envVars, ...cumulativePathParams]
        this.broadcastFieldVariables(pp.id, varsForThisField, sourceId)
      }

      if (pp.key && pp.key.trim() !== '') {
        const contextForResolve: TransformedContext = { ...envContext }
        for (const prev of cumulativePathParams) {
          contextForResolve[prev.name] = prev.value
        }
        const resolvedValue = this.resolveKeyValue(pp, contextForResolve)
        addOrReplace(cumulativePathParams, pp.key, resolvedValue)
      }
    }

    // Calculate for headers
    const headers = data.headers
    const cumulativeHeaders: { name: string; value: string }[] = []

    for (const h of headers) {
      // Skip disabled headers (enabled defaults to true if undefined)
      if (h.enabled === false) {
        continue
      }

      if (h.id) {
        const varsForThisField = [...envVars, ...cumulativeHeaders]
        this.broadcastFieldVariables(h.id, varsForThisField, sourceId)
      }

      if (h.key && h.key.trim() !== '') {
        const contextForResolve: TransformedContext = { ...envContext }
        for (const prev of cumulativeHeaders) {
          contextForResolve[prev.name] = prev.value
        }
        const resolvedValue = this.resolveKeyValue(h, contextForResolve)
        addOrReplace(cumulativeHeaders, h.key, resolvedValue)
      }
    }

    // Calculate for params (query params)
    const params = data.params ?? []
    const cumulativeParams: { name: string; value: string }[] = []

    for (const p of params) {
      // Skip disabled params (enabled defaults to true if undefined)
      if (p.enabled === false) {
        continue
      }

      if (p.id) {
        const varsForThisField = [...envVars, ...cumulativeParams]
        this.broadcastFieldVariables(p.id, varsForThisField, sourceId)
      }

      if (p.key && p.key.trim() !== '') {
        const contextForResolve: TransformedContext = { ...envContext }
        for (const prev of cumulativeParams) {
          contextForResolve[prev.name] = prev.value
        }
        const resolvedValue = this.resolveKeyValue(p, contextForResolve)
        addOrReplace(cumulativeParams, p.key, resolvedValue)
      }
    }

    // URL field gets env + ALL path params
    const urlVariableId = `${requestId}:url`
    const urlVars = [...envVars, ...cumulativePathParams]
    this.broadcastFieldVariables(urlVariableId, urlVars, sourceId)
  }

  /**
   * Broadcast available variables for a specific field
   */
  private broadcastFieldVariables(
    variableId: string,
    variables: { name: string; value: string }[],
    sourceId?: string
  ): void {
    const previous = this.availableVariablesPerField.get(variableId)
    const hasChanged = previous?.length !== variables.length ||
      variables.some((v, i) => {
        const prevItem = previous[i]
        return prevItem && (prevItem.name !== v.name || prevItem.value !== v.value)
      })

    if (hasChanged) {
      this.availableVariablesPerField.set(variableId, variables)
      this.broadcastToRenderer('context:available-variables', { variableId, variables, sourceId })
    }
  }

  // =========================================================================
  // Getters for URL and Code Snippets
  // =========================================================================

  /**
   * Get the resolved URL for a request
   */
  getResolvedUrl(requestId: string): ResolvedUrlResult | undefined {
    return this.resolvedUrls.get(requestId)
  }

  /**
   * Get the code snippets for a request
   */
  getCodeSnippets(requestId: string): CodeSnippetsResult | undefined {
    return this.codeSnippets.get(requestId)
  }

  /**
   * Get the request context for a request (used by HTTPExecutionService)
   */
  getRequestContext(requestId: string): RequestContext | undefined {
    return this.requestContexts.get(requestId)
  }

  /**
   * Resolve a single value using the request's environment context
   * Used by HTTPExecutionService to resolve headers, body, etc.
   */
  resolveValue(value: string, requestId: string): string {
    const ctx = this.requestContexts.get(requestId)
    if (!ctx?.environmentId) {
      return value
    }

    const envContext = this.transformedContexts.get(ctx.environmentId)
    if (!envContext) {
      return value
    }

    return this.transformValue(value, envContext)
  }

  /**
   * Get all resolved URLs as a plain object (for IPC)
   */
  getAllResolvedUrls(): Record<string, ResolvedUrlResult> {
    const result: Record<string, ResolvedUrlResult> = {}
    for (const [key, value] of this.resolvedUrls) {
      result[key] = value
    }
    return result
  }

  /**
   * Get all code snippets as a plain object (for IPC)
   */
  getAllCodeSnippets(): Record<string, CodeSnippetsResult> {
    const result: Record<string, CodeSnippetsResult> = {}
    for (const [key, value] of this.codeSnippets) {
      result[key] = value
    }
    return result
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
        // logger.debug('[ContextService] Recalculating request due to environment change', {
        //   requestId,
        //   environmentId: ctx.environmentId
        // })
        this.recalculateRequestContext(requestId)
      }
    }
  }

  /**
   * Clear all data without unsubscribing from events
   * Used when a file is closed
   */
  clearAll(): void {
    logger.info('[ContextService] Clearing all data...')
    this.environmentMeta.clear()
    this.transformedContexts.clear()
    this.variableTransformResults.clear()
    this.requestContexts.clear()
    this.resolvedUrls.clear()
    this.codeSnippets.clear()
    this.availableVariablesPerField.clear()
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
    this.clearAll()
    this.initialized = false
  }
}

/** Singleton instance */
export const contextService = new ContextService()
