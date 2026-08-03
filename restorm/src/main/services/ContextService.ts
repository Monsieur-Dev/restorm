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
import { resolveWithContextPriority } from '../../shared/utils/handlebars/resolveWithContextPriority'
import { resolveJsonBodyTemplate, isJsonContentType } from '../../shared/utils/handlebars/resolveJsonBodyTemplate'
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
import { registerHandlebarsHelpers } from '../../shared/utils/handlebars/registerAll'
import { pubsub, PUBSUB_TOPICS, collectionStore } from './CollectionStore'
import { KeyValue as KeyValueModel } from '../../shared/models'
import { StringValue, EnumListValue, CustomListValue, CustomListMultiValue } from '../../shared/types/collections'
import type { CustomValueList } from '../../shared/types/collections'
import { isEnvironmentFolder, isRequest, isScenario, isAnyFolder } from '../../shared/types/folderTypes'
import type { Folder, EnvironmentFolder, FolderItem } from '../../shared/types/folderTypes'
import type { Scenario } from '../../shared/types/scenario'
import { isExpressionValue, isCustomListValue, isCustomListMultiValue, isSecretValue } from '../../shared/utils/valueHelpers'
import type { SecretValue } from '../../shared/types/valueTypes/SecretValue'
import { collectItemDirectSecrets, collectItemReferencedVars } from '../../shared/secrets/collectItemSecrets'
import { pickSelectedEnvId, setActiveEnvChangeListener } from '../mcp/tools/activeState'
import { resolveUrl } from './URLResolver'
import { secretHydrationService, canonicalStringify } from './secrets/SecretHydrationService'
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
  RequestData,
  ResolutionContexts
} from './ContextServiceTypes'

// Re-export public types so existing imports from './ContextService' keep working
export type { FullRequestData, ResolvedUrlResult, CodeSnippetsResult, ResolutionContexts } from './ContextServiceTypes'

function normalizeKeyValues(values: unknown[]): KeyValue[] {
  return values.map((v) => KeyValueModel.fromPlain(v as Record<string, unknown>))
}

/** Safety cap on how far an item's ancestor chain is walked (anti-runaway). */
const MAX_ANCESTOR_WALK_DEPTH = 32

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
    soapSnippetTemplate: null,
    jsonRpcSnippetTemplate: null
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

    // Per-item direct-secret resolution: (re)resolve an item's own secrets when
    // it is created or edited, forget it when deleted. Scenarios travel on the
    // FOLDER_* channel (a scenario is a folder-like container).
    const onItemChanged = (payload: DocumentChangedPayload): void => {
      const item = payload.document as FolderItem | undefined
      if (item && (isRequest(item) || isScenario(item))) void this.hydrateItemSecrets(item)
    }
    this.subscriptions.push(
      eventBusService.subscribe<DocumentChangedPayload>(DocumentEvents.REQUEST_CREATED, onItemChanged),
      eventBusService.subscribe<DocumentChangedPayload>(DocumentEvents.REQUEST_UPDATED, onItemChanged),
      eventBusService.subscribe<DocumentChangedPayload>(DocumentEvents.FOLDER_UPDATED, onItemChanged),
      eventBusService.subscribe<DocumentDeletedPayload>(DocumentEvents.REQUEST_DELETED, (p) => { this.forgetItemSecrets(p.id) }),
      eventBusService.subscribe<DocumentDeletedPayload>(DocumentEvents.FOLDER_DELETED, (p) => { this.forgetItemSecrets(p.id) })
    )

    // Switching the active environment changes which env an item inherits, so
    // recompute every item's badge when the renderer reports a new selection.
    setActiveEnvChangeListener(() => { this.recomputeAllItemStatuses() })

    // On every full (re)load of the tree, eagerly resolve each item's own
    // secrets so request / scenario badges are correct before any editor opens.
    collectionStore.onCollectionsSet(() => { this.hydrateAllItemSecrets() })

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

    // Calculate and store transformed context (synchronously, with secrets
    // still masked) so a consumer reading immediately sees the structure.
    this.recalculateContext(envId)

    // If a request tab was opened before this environment was processed,
    // we must recalculate those requests now that the context exists.
    this.recalculateRequestsUsingEnvironment(envId)

    // Hydrate this env's SecretValues into the context (async). Once the
    // resolvers return, `recalculateContext` re-runs with the populated
    // `.resolved` values and re-broadcasts so `{{secretVar}}` (and any
    // expression composing it) resolves in the preview + downstream.
    void this.hydrateEnvironmentSecrets(envId)
  }

  /**
   * Handle environment updated event
   */
  private handleEnvironmentUpdated(payload: DocumentChangedPayload): void {
    const envId = payload.id
    const env = payload.document as Environment
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

      // Re-hydrate secrets for this env (a variable may have changed an
      // env-var name / source params, or a new secret variable was added)
      // and its descendants, then re-broadcast with resolved values.
      void this.hydrateEnvironmentSecretsCascade(envId)
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

    // Abort any in-flight secret hydration for this env, drop its resolution
    // cache, and clear its spinner state — the env is going away.
    this.envHydrationAborters.get(envId)?.abort()
    this.envHydrationAborters.delete(envId)
    secretHydrationService.clearScope(envId)
    this.resolvingEnvSecretVars.delete(envId)
    this.erroredEnvSecretVars.delete(envId)
    this.setEnvironmentResolving(envId, false)
    this.setEnvironmentError(envId, false)

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

    // Custom value lists live on the owning env-folder; an env variable
    // typed as a CustomListValue resolves its label → entry value here.
    const ownerFolder = collectionStore.findEnvironmentFolderByEnvironmentId(envId)
    const customValueLists = ownerFolder?.customValueLists

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
        const transformedValue = this.resolveEnvKeyValue(kv, finalContext, customValueLists)
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
      if (kv.key && isExpressionValue(kv.value)) {
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
        if (kv.key && isExpressionValue(kv.value)) {
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
      return resolveWithContextPriority(rawValue, context)
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
    if (isExpressionValue(kv.value)) {
      return this.transformValue(raw, context)
    }
    return raw
  }

  /**
   * Store a transformation result and broadcast it to the renderer
   */
  private storeAndBroadcastTransformResult(variableId: string, result: VariableTransformResult, sourceId?: string): void {
    this.variableTransformResults.set(variableId, result)
    this.broadcastToRenderer('context:variable-transformed', {
      variableId,
      ...result,
      sourceId
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
      availableEnvironmentIds: [],
      keyValueGroups,
      fullData: null
    })

    // Calculate transformations for all KeyValue groups
    this.recalculateRequestContext(requestId)
  }

  /**
   * Set the env IDs visible to a request through its env-folder
   * ancestor chain. The renderer recomputes this whenever the request
   * tab's `environments` prop changes. Only used for auth-resolver
   * env inheritance — see `HTTPExecutionService.resolveAuthShape`.
   */
  setAvailableEnvironments(requestId: string, environmentIds: string[]): void {
    const ctx = this.requestContexts.get(requestId)
    if (!ctx) return
    ctx.availableEnvironmentIds = environmentIds
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
  updateRequestKeyValues(requestId: string, groupName: string, keyValues: KeyValue[], sourceId?: string): void {
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
    this.recalculateRequestContext(requestId, sourceId)
  }

  /**
   * Recalculate all KeyValue transformations for a request
   */
  private recalculateRequestContext(requestId: string, sourceId?: string): void {
    const ctx = this.requestContexts.get(requestId)
    if (!ctx) return

    // The base context is the selected environment's, and ONLY that. A scenario
    // run's values are deliberately absent: they live in the disposable
    // `ResolutionContexts` the engine passes to the dispatch, never in the
    // request's own state. That is what makes this recompute — which is also
    // what the request panel displays — show the request's own values at every
    // instant, including while a run is in flight.
    const baseContext: TransformedContext = { ...this.envContextFor(ctx) }

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
            }, sourceId)
          }
        }
      }
    }

    // Calculate resolved URL and code snippets if we have full data
    if (ctx.fullData) {
      const updatedData = this.buildResolvableData(ctx, ctx.fullData, requestId)

      // Delegate URL resolution to URLResolver. No run layer here: this recompute
      // feeds the CACHED url + the request panel, both of which belong to the
      // request. A dispatch that carries a run's values resolves its own URL
      // through `resolveUrlForRequest`, against a context it throws away.
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

  /**
   * The request's `fullData`, re-synced from the live KeyValue groups and with
   * custom-list rows materialised — the shape URLResolver and the snippet
   * generator consume.
   *
   * Shared by the display recompute and by a dispatch's own URL resolution so
   * the two cannot drift: a request whose URL the panel shows one way and the
   * wire another is the failure mode this separation exists to prevent.
   */
  private buildResolvableData(ctx: RequestContext, fullData: FullRequestData, requestId: string): FullRequestData {
    // Sync fullData with keyValueGroups to ensure we use the latest values
    const headersFromGroup = ctx.keyValueGroups.get('headers')
    const paramsFromGroup = ctx.keyValueGroups.get('params')
    const pathParamsFromGroup = ctx.keyValueGroups.get('pathParams')

    const updatedData: FullRequestData = {
      ...fullData,
      headers: headersFromGroup ?? fullData.headers,
      ...(paramsFromGroup !== undefined ? { params: paramsFromGroup } : fullData.params !== undefined ? { params: fullData.params } : {}),
      ...(pathParamsFromGroup !== undefined ? { pathParams: pathParamsFromGroup } : fullData.pathParams !== undefined ? { pathParams: fullData.pathParams } : {})
    }

    // Materialise any CustomListValue params/pathParams into plain
    // resolved StringValues so URLResolver (which only special-cases
    // enums) builds the query/path with the substituted value.
    if (updatedData.params) updatedData.params = this.materializeCustomListKVs(updatedData.params, requestId)
    if (updatedData.pathParams) updatedData.pathParams = this.materializeCustomListKVs(updatedData.pathParams, requestId)
    return updatedData
  }

  // =========================================================================
  // Disposable per-execution resolution contexts
  // =========================================================================

  /**
   * Build the DISPOSABLE contexts one execution of `requestId` resolves
   * against: a copy of what the request itself resolves against, enriched with
   * the run's values, one object per row family.
   *
   * Pure. It reads the stored request + environment state and **writes
   * nothing** — no field, no cache, no broadcast. That is the property, not an
   * implementation detail: a run cannot leave a value behind if the only place
   * it was ever written is an object the caller drops.
   *
   * Call it JUST BEFORE each request executes, never once per run — the
   * overlay a run carries grows as the run proceeds (an answered input, a
   * `setVariable`), and a variable declared between two requests must reach the
   * second and not the first.
   *
   * `runOverlay` absent (the request panel's Send, an MCP dispatch outside a
   * run) yields the request's own values alone, which is the correct answer for
   * those callers rather than a degraded one.
   */
  composeResolutionContexts(requestId: string, runOverlay?: TransformedContext): ResolutionContexts {
    const ctx = this.requestContexts.get(requestId)
    const env = ctx ? this.envContextFor(ctx) : undefined
    const overlay = runOverlay && Object.keys(runOverlay).length > 0 ? runOverlay : undefined
    // One FRESH object per family. Spreading four times rather than sharing one
    // is deliberate: the families are blind to each other, and a shared object
    // would let a row accumulated by one family be read by another the moment
    // anything starts writing into these.
    const compose = (): TransformedContext => ({ ...(env ?? {}), ...(overlay ?? {}) })
    const contexts: ResolutionContexts = {
      ...(overlay !== undefined ? { runOverlay: { ...overlay } } : {}),
      base: compose(),
      pathParams: compose(),
      queryParams: compose(),
      headers: compose()
    }
    // `bodyFields` exists only for the two body types that carry rows. Absent
    // means "no field family here at all"; a field-bearing body with zero
    // fields still gets one, empty.
    const bodyType = ctx?.fullData?.body?.type
    if (bodyType === 'form-data' || bodyType === 'x-www-form-urlencoded') contexts.bodyFields = compose()
    return contexts
  }

  /**
   * Re-seed an execution's disposable contexts from the environment as it
   * stands NOW, keeping the run's values and the object identity.
   *
   * A dispatch can change the environment under itself: hydrating an
   * env-folder secret populates the resolved plaintext after the copy was
   * taken, so the copy still carries the masked (empty) value. The whole
   * dispatch — url, headers, body, and the history entry the caller archives
   * afterwards from this same object — has to see the hydrated value, so this
   * refreshes IN PLACE rather than returning a second object the caller would
   * have to remember to swap in everywhere.
   *
   * Call it only after something has genuinely changed the environment
   * context. It is not a substitute for composing per request execution.
   */
  refreshResolutionContexts(requestId: string, contexts: ResolutionContexts): void {
    const fresh = this.composeResolutionContexts(requestId, contexts.runOverlay)
    const reseed = (target: TransformedContext, source: TransformedContext): void => {
      // `Reflect.deleteProperty`, not `delete target[key]`: the lint rule
      // `no-dynamic-delete` rejects a computed-key delete, and suppressing it
      // is not allowed here. Same semantics, and the keys are genuinely
      // dynamic — this clears whatever the previous compose left behind.
      for (const key of Object.keys(target)) Reflect.deleteProperty(target, key)
      Object.assign(target, source)
    }
    reseed(contexts.base, fresh.base)
    reseed(contexts.pathParams, fresh.pathParams)
    reseed(contexts.queryParams, fresh.queryParams)
    reseed(contexts.headers, fresh.headers)
    // The body-field family's PRESENCE describes the request's body type, which
    // a hydration cannot change — re-seed it when it is there, never create it.
    if (contexts.bodyFields && fresh.bodyFields) reseed(contexts.bodyFields, fresh.bodyFields)
  }

  /**
   * The URL a dispatch should send to.
   *
   * With `contexts`, the URL is resolved FRESH against them and returned to the
   * caller only — it is never cached and never broadcast, so a run's value
   * reaches the wire without reaching the request. Without them, this is the
   * cached URL the request's own recompute produced, byte for byte.
   */
  resolveUrlForRequest(requestId: string, contexts?: ResolutionContexts): ResolvedUrlResult | undefined {
    if (!contexts) return this.resolvedUrls.get(requestId)
    const ctx = this.requestContexts.get(requestId)
    if (!ctx?.fullData) return this.resolvedUrls.get(requestId)
    const data = this.buildResolvableData(ctx, ctx.fullData, requestId)
    return resolveUrl(data, contexts.pathParams, this.transformValue.bind(this), contexts.runOverlay, contexts.queryParams)
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

    // Env-only field: the environment / env-folder variables with no field-local
    // additions. Scalar Handlebars inputs that are not the URL and carry no
    // cumulative field context (procedure, topic, routing key, auth, ...) — for
    // every protocol — subscribe to this so their {{...}} autocomplete offers the
    // environment variables alongside the helper functions.
    this.broadcastFieldVariables(`${requestId}:env`, envVars, sourceId)

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
   * Collect every `SecretValue` reachable through a request's active
   * environment chain (the selected env-folder environment + all of its
   * ancestors). These are the credentials that feed the transformed
   * context a request reads from — a `SecretValue` used as an env-folder
   * variable resolves to `''` until its `.resolved` is populated, exactly
   * like the request's own KeyValue secrets. Enabled rows only: a disabled
   * variable never reaches the context.
   *
   * The caller hydrates the returned secrets (which sets `.resolved` in
   * place on the live `environmentMeta` rows) and then calls
   * `refreshEnvironmentContext(requestId)` so the resolved plaintext lands
   * in the request's `baseContext`.
   */
  collectEnvironmentSecrets(requestId: string): SecretValue[] {
    const ctx = this.requestContexts.get(requestId)
    if (!ctx?.environmentId) return []
    return this.collectSecretsForEnvChain(ctx.environmentId)
  }

  /**
   * Collect every enabled `SecretValue` reachable from an environment's
   * own variables plus its ancestor chain (root → parent → self). Shared
   * by the request path (`collectEnvironmentSecrets`) and the env-folder
   * preview path (`hydrateEnvironmentSecrets`) so both resolve secrets
   * through the exact same set — DRY, no parallel walk.
   */
  private collectSecretsForEnvChain(environmentId: string): SecretValue[] {
    const secrets: SecretValue[] = []
    const seen = new Set<string>()
    const collectFrom = (envId: string): void => {
      const meta = this.environmentMeta.get(envId)
      if (!meta) return
      for (const kv of meta.rawVariables) {
        if (kv.enabled === false) continue
        if (isSecretValue(kv.value)) secrets.push(kv.value)
      }
    }
    // Active environment + its ancestor chain (root → parent).
    for (const envId of [...this.getParentChain(environmentId), environmentId]) {
      if (seen.has(envId)) continue
      seen.add(envId)
      collectFrom(envId)
    }
    return secrets
  }

  /**
   * Hydrate every `SecretValue` reachable from an environment's chain
   * (own + ancestors) and, once resolved, recompute + re-broadcast the
   * environment's transformed context so `{{secretVar}}` and any
   * expression composing it (`apiKey2 = {{apiKey}}`) resolve to the
   * plaintext instead of the masked empty string.
   *
   * scopeId = the environment's own id: stable for the lifetime of the
   * open file, so the per-scope cache in `SecretHydrationService` serves
   * repeated recalcs without re-hitting the provider. (The request path
   * uses requestId as its scope; both share the same hydrate logic, only
   * the scope key differs.)
   *
   * Hydration is async; callers `void` it. The synchronous
   * `recalculateContext` already ran (masked) before this resolves, so a
   * reader that polls immediately gets structure now and the resolved
   * values land on the follow-up broadcast.
   */
  private async hydrateEnvironmentSecrets(environmentId: string): Promise<void> {
    // Only this env's OWN secrets — NOT inherited ones. An inherited secret is
    // resolved once by its owning ancestor and flows into this env's context
    // through inheritance; re-resolving it here would re-fetch the SAME
    // credential under a different cache scope (a per-env cache miss), so a
    // child env with no secrets of its own would needlessly re-run a slow
    // ancestor secret. The descendants' contexts are refreshed below.
    // Own enabled secrets WITH their variable names — the names let an item that
    // references `{{thatVar}}` light its inherited badge only for the secrets it
    // actually uses (reference-aware), not for any secret in the env.
    const meta = this.environmentMeta.get(environmentId)
    const secretEntries = (meta?.rawVariables ?? [])
      .filter((kv) => kv.enabled !== false && isSecretValue(kv.value))
      .map((kv) => ({ key: kv.key, sv: kv.value as SecretValue }))
    if (secretEntries.length === 0) return

    // A fresh hydration supersedes any in-flight one for this env, and closing
    // the env / project aborts it (see deleteEnvironmentCascade / clearAll), so
    // a slow resolver — a long network / file fetch, or the cancellable sleep —
    // stops instead of running to completion after the env is gone.
    this.envHydrationAborters.get(environmentId)?.abort()
    const aborter = new AbortController()
    this.envHydrationAborters.set(environmentId, aborter)

    // Signal "this env is resolving its secrets" for the duration so the UI can
    // show a spinner (env tab, env-folder sidebar entry, env list row, …) while
    // at least one variable is in flight. Clear any stale error first — we are
    // (re)attempting, so the previous failure no longer reflects reality until
    // this batch finishes. The per-variable resolving set drives the
    // reference-aware item badges.
    this.resolvingEnvSecretVars.set(environmentId, new Set(secretEntries.map((e) => e.key)))
    this.erroredEnvSecretVars.set(environmentId, new Set())
    this.setEnvironmentResolving(environmentId, true)
    this.setEnvironmentError(environmentId, false)
    const failedKeys = new Set<string>()
    try {
      // Hydrate each secret INDEPENDENTLY: a single failing secret (e.g. an env
      // var that isn't set, whose resolver rejects) must not abort the whole
      // batch — the others still resolve, and the failing one just stays empty.
      // A shared batch hydrate would reject on the first failure and skip every
      // secret after it plus the rebroadcast below.
      await Promise.all(
        secretEntries.map(async ({ key, sv }) => {
          try {
            await secretHydrationService.hydrate(environmentId, [sv], aborter.signal)
          } catch (error) {
            if (aborter.signal.aborted) return // expected on close / supersede
            failedKeys.add(key)
            logger.warn('[ContextService] env secret hydration failed', {
              environmentId,
              source: sv.source,
              error: String(error)
            })
          }
        })
      )
    } finally {
      if (this.envHydrationAborters.get(environmentId) === aborter) {
        this.envHydrationAborters.delete(environmentId)
      }
      if (!aborter.signal.aborted) {
        // Per-variable verdict (drives reference-aware item badges) set BEFORE the
        // env-level setters, which trigger the per-item recompute that reads it.
        this.resolvingEnvSecretVars.set(environmentId, new Set())
        this.erroredEnvSecretVars.set(environmentId, failedKeys)
      }
      this.setEnvironmentResolving(environmentId, false)
      // Don't stamp an error verdict on an aborted run (env closed / superseded);
      // the cleared-at-start state stays, and a newer hydration owns the verdict.
      if (!aborter.signal.aborted) this.setEnvironmentError(environmentId, failedKeys.size > 0)
    }

    // Aborted (env closed / superseded) → don't recompute: the env may be gone,
    // and a newer hydration owns the recompute.
    if (aborter.signal.aborted) return

    // Resolved plaintext now lives on the live `environmentMeta` rows. Recompute
    // this env AND its descendants (`recalculateContextCascade`) so a child env
    // inherits the freshly-resolved value WITHOUT re-fetching it itself.
    this.recalculateContextCascade(environmentId)
    this.recalculateRequestsUsingEnvironment(environmentId)
  }

  /**
   * Collect an environment's OWN enabled `SecretValue`s (NOT inherited from
   * ancestors). Inherited secrets are resolved by their owning ancestor and
   * reach this env through context inheritance, so hydrating only the own set
   * keeps each credential fetched exactly once. Contrast with
   * `collectSecretsForEnvChain` (own + ancestors), which the request path uses
   * to gather everything a request reads.
   */
  private collectOwnEnvSecrets(environmentId: string): SecretValue[] {
    const meta = this.environmentMeta.get(environmentId)
    if (!meta) return []
    const secrets: SecretValue[] = []
    for (const kv of meta.rawVariables) {
      if (kv.enabled === false) continue
      if (isSecretValue(kv.value)) secrets.push(kv.value)
    }
    return secrets
  }

  /** Environments currently hydrating at least one secret (drives the UI spinners). */
  private readonly resolvingEnvironments = new Set<string>()

  /** In-flight secret-hydration aborters, keyed by environment id. Aborted when
   * a newer hydration supersedes, the env is deleted, or the project closes. */
  private readonly envHydrationAborters = new Map<string, AbortController>()

  /** Mark an environment as (not) resolving its secrets and broadcast the change. */
  private setEnvironmentResolving(environmentId: string, resolving: boolean): void {
    const had = this.resolvingEnvironments.has(environmentId)
    if (resolving === had) return
    if (resolving) this.resolvingEnvironments.add(environmentId)
    else this.resolvingEnvironments.delete(environmentId)
    this.broadcastToRenderer('context:env-secrets-resolving', { environmentId, resolving })
    // Items inheriting this env (active env + chain) reflect its resolving state.
    this.recomputeAllItemStatuses()
  }

  /** Snapshot of the environments currently resolving secrets (initial UI sync). */
  getResolvingEnvironmentIds(): string[] {
    return [...this.resolvingEnvironments]
  }

  /** Environments whose last secret hydration left AT LEAST ONE own secret
   * unresolved (resolver rejected, e.g. a missing env var). Drives the error
   * badge in the same places as the resolving spinner. */
  private readonly erroredEnvironments = new Set<string>()

  /** Mark an environment as (not) having a secret-resolution error and broadcast. */
  private setEnvironmentError(environmentId: string, hasError: boolean): void {
    const had = this.erroredEnvironments.has(environmentId)
    if (hasError === had) return
    if (hasError) this.erroredEnvironments.add(environmentId)
    else this.erroredEnvironments.delete(environmentId)
    this.broadcastToRenderer('context:env-secrets-error', { environmentId, hasError })
    // Items inheriting this env reflect its error state.
    this.recomputeAllItemStatuses()
  }

  /** Snapshot of the environments with a secret-resolution error (initial UI sync). */
  getErroredEnvironmentIds(): string[] {
    return [...this.erroredEnvironments]
  }

  // ──────────────────────────────────────────────────────────────────────
  // Per-ITEM secret status (requests, all protocols + scenarios)
  //
  // An item's effective status combines two sources:
  //   • DIRECT — secrets the item holds in its own fields (a header / param /
  //     auth / body value, a scenario node operand). These are resolved EAGERLY
  //     here on load + on every edit, so the badge shows even on an item the
  //     user never opened.
  //   • INHERITED — the secrets of the ACTIVE environment (+ its parent chain)
  //     the item resolves {{variables}} against. Reuses the per-env sets above.
  //
  // A single `context:item-secrets-status` broadcast per item lets the renderer
  // badge every surface (tab title, sidebar row, scenario node) with one hook.
  // ──────────────────────────────────────────────────────────────────────

  /** Items currently resolving at least one of their OWN (direct) secrets. */
  private readonly directResolvingItems = new Set<string>()
  /** Items whose last OWN-secret resolution left at least one unresolved. */
  private readonly directErroredItems = new Set<string>()
  /** In-flight direct-secret hydration aborters, keyed by item id. */
  private readonly itemHydrationAborters = new Map<string, AbortController>()
  /** Every item we've walked (for a full recompute when an env toggles). */
  private readonly knownItemIds = new Set<string>()
  /** Last effective status broadcast per item, to dedupe re-broadcasts. */
  private readonly itemEffectiveStatus = new Map<string, { resolving: boolean; error: boolean; errorVars: string[] }>()
  /** Per-env secret VARIABLE names currently resolving / left in error — the
   * reference-aware counterpart of `resolvingEnvironments`/`erroredEnvironments`
   * (which stay per-env booleans for the env-folder's own blanket badge). */
  private readonly resolvingEnvSecretVars = new Map<string, Set<string>>()
  private readonly erroredEnvSecretVars = new Map<string, Set<string>>()
  /** The env-variable names each item references via `{{…}}` (cached per item),
   * so its inherited badge lights only for secrets it actually uses. */
  private readonly itemReferencedVars = new Map<string, Set<string>>()

  /** All env ids under an env-folder (own + nested sub-environments). */
  private collectEnvFolderEnvIds(environments: Environment[]): string[] {
    const ids: string[] = []
    for (const env of environments) {
      ids.push(env.id)
      if (env.subEnvironments) ids.push(...this.collectEnvFolderEnvIds(env.subEnvironments))
    }
    return ids
  }

  /**
   * The environment ids an item inherits — its nearest ancestor env-folder's
   * ACTIVE environment plus that environment's parent chain. Empty when the item
   * lives outside any env-folder. The active env is the renderer-selected one
   * (falls back to the folder's first environment).
   */
  private getInheritedEnvChainForItem(itemId: string): string[] {
    let folder: Folder | EnvironmentFolder | Scenario | null = collectionStore.findParentFolder(itemId)
    while (folder && !isEnvironmentFolder(folder)) {
      folder = collectionStore.findParentFolder(folder.id)
    }
    if (!folder || !isEnvironmentFolder(folder)) return []
    const envFolder = folder
    const liveEnvIds = this.collectEnvFolderEnvIds(envFolder.environments)
    const activeId = pickSelectedEnvId(envFolder.id, liveEnvIds) ?? envFolder.environments[0]?.id
    if (activeId === undefined) return []
    return [...this.getParentChain(activeId), activeId]
  }

  /** Recompute an item's effective status; broadcast on change. Effective =
   * DIRECT (a secret the item holds in its own fields) ∪ INHERITED-and-REFERENCED
   * (a secret variable of the item's active env chain that the item actually
   * references via `{{…}}`). The inherited half is reference-aware: an env having
   * a failing secret does NOT light an item that doesn't use it.
   *
   * The broadcast also carries the environment VARIABLE NAMES behind an
   * inherited failure. One unresolvable variable legitimately puts the badge on
   * every request that references it, so without the names the user sees a tree
   * of broken-looking requests and no hint that a single variable explains all
   * of them. */
  private computeItemEffectiveStatus(itemId: string): void {
    const chain = this.getInheritedEnvChainForItem(itemId)
    const refs = this.itemReferencedVars.get(itemId)
    const referencedIn = (envVars: Set<string> | undefined): string[] =>
      envVars === undefined || refs === undefined ? [] : [...envVars].filter((v) => refs.has(v))
    const inheritedResolving = chain.some((e) => referencedIn(this.resolvingEnvSecretVars.get(e)).length > 0)
    const errorVars = [
      ...new Set(chain.flatMap((e) => referencedIn(this.erroredEnvSecretVars.get(e))))
    ].sort()
    const resolving = this.directResolvingItems.has(itemId) || inheritedResolving
    const error = this.directErroredItems.has(itemId) || errorVars.length > 0
    const prev = this.itemEffectiveStatus.get(itemId)
    if (
      prev?.resolving === resolving &&
      prev.error === error &&
      prev.errorVars.join('\u0000') === errorVars.join('\u0000')
    ) return
    this.itemEffectiveStatus.set(itemId, { resolving, error, errorVars })
    this.broadcastToRenderer('context:item-secrets-status', { itemId, resolving, error, errorVars })
  }

  /** Recompute every known item — used when an env's status flips or the
   * active environment changes (which env an item inherits). Cheap: a handful
   * of items, each a set lookup + a short parent-chain walk. */
  recomputeAllItemStatuses(): void {
    for (const itemId of this.knownItemIds) this.computeItemEffectiveStatus(itemId)
  }

  /** Snapshot of every item's effective secret status (initial UI sync). */
  getItemSecretStatuses(): { itemId: string; resolving: boolean; error: boolean; errorVars: string[] }[] {
    return [...this.itemEffectiveStatus].map(([itemId, s]) => ({
      itemId, resolving: s.resolving, error: s.error, errorVars: s.errorVars
    }))
  }

  /**
   * Eagerly (re)resolve an item's OWN direct secrets and refresh its badge.
   * Per-secret resilient (one failing secret doesn't abort the rest); a fresh
   * call supersedes any in-flight one for the same item. Items with no direct
   * secret still get a status recompute so their INHERITED badge is correct.
   */
  private async hydrateItemSecrets(item: FolderItem): Promise<void> {
    const itemId = item.id
    this.knownItemIds.add(itemId)
    // Cache which env vars this item references, for the reference-aware
    // inherited badge (recomputed here so an edit that adds/removes a `{{var}}`
    // is reflected).
    this.itemReferencedVars.set(itemId, collectItemReferencedVars(item))
    const secrets = collectItemDirectSecrets(item)

    // Supersede any in-flight resolution for this item.
    this.itemHydrationAborters.get(itemId)?.abort()

    if (secrets.length === 0) {
      this.itemHydrationAborters.delete(itemId)
      this.directResolvingItems.delete(itemId)
      this.directErroredItems.delete(itemId)
      this.computeItemEffectiveStatus(itemId)
      return
    }

    const aborter = new AbortController()
    this.itemHydrationAborters.set(itemId, aborter)
    this.directResolvingItems.add(itemId)
    this.directErroredItems.delete(itemId)
    this.computeItemEffectiveStatus(itemId)

    let anyFailed = false
    await Promise.all(
      secrets.map(async (sv) => {
        try {
          await secretHydrationService.hydrate(itemId, [sv], aborter.signal)
        } catch (error) {
          if (aborter.signal.aborted) return
          anyFailed = true
          logger.warn('[ContextService] item secret hydration failed', { itemId, source: sv.source, error: String(error) })
        }
      })
    )

    if (aborter.signal.aborted) return
    this.itemHydrationAborters.delete(itemId)
    this.directResolvingItems.delete(itemId)
    this.setItemDirectError(itemId, anyFailed)
    this.computeItemEffectiveStatus(itemId)
  }

  /** Toggle an item's direct-secret error membership (param keeps the boolean
   * honest so flow analysis doesn't narrow a closure-set flag to a literal). */
  private setItemDirectError(itemId: string, hasError: boolean): void {
    if (hasError) this.directErroredItems.add(itemId)
    else this.directErroredItems.delete(itemId)
  }

  /** Forget an item's per-item state (on delete / project close). */
  private forgetItemSecrets(itemId: string): void {
    this.itemHydrationAborters.get(itemId)?.abort()
    this.itemHydrationAborters.delete(itemId)
    this.directResolvingItems.delete(itemId)
    this.directErroredItems.delete(itemId)
    this.knownItemIds.delete(itemId)
    this.itemReferencedVars.delete(itemId)
    secretHydrationService.clearScope(itemId)
    if (this.itemEffectiveStatus.delete(itemId)) {
      this.broadcastToRenderer('context:item-secrets-status', { itemId, resolving: false, error: false, errorVars: [] })
    }
  }

  /**
   * Walk the whole tree and eagerly resolve every request's / scenario's direct
   * secrets. Called once after a project loads (the per-env hydration already
   * ran), so badges are correct before any editor opens.
   */
  hydrateAllItemSecrets(): void {
    const walk = (item: FolderItem): void => {
      if (isRequest(item) || isScenario(item)) void this.hydrateItemSecrets(item)
      // Walk children exactly once. A runtime scenario also satisfies the folder
      // guards (it carries `items`), so test it FIRST to avoid walking its
      // children twice (and re-hydrating each child request twice on load).
      const children = isScenario(item) ? (item.items ?? []) : isAnyFolder(item) ? item.items : []
      for (const child of children) walk(child)
    }
    for (const collection of collectionStore.getCollections()) walk(collection)
  }

  /**
   * Re-resolve every (secret) variable an environment OWNS: drop their
   * resolution cache, blank the in-memory plaintext, recompute the env + its
   * descendants (so the secrets — and any expression composing them — go empty
   * immediately), then re-hydrate. The env-level equivalent of the per-secret
   * "refresh" button. Returns the number of own secrets refreshed (0 when the
   * env isn't registered / has no secret variables). Does NOT touch the
   * persisted document — resolved plaintext is never saved.
   */
  refreshEnvironmentSecrets(environmentId: string): number {
    const secrets = this.collectOwnEnvSecrets(environmentId)
    for (const sv of secrets) {
      secretHydrationService.invalidateAll(sv.source, sv.params)
      sv.resolved = undefined
    }
    // Recompute now (secrets blank) so the preview clears, then re-hydrate.
    this.recalculateContextCascade(environmentId)
    void this.hydrateEnvironmentSecretsCascade(environmentId)
    return secrets.length
  }

  /**
   * Re-hydrate secrets for an environment and all its descendants. Used
   * on ENVIRONMENT_UPDATED, mirroring `recalculateContextCascade`.
   */
  private async hydrateEnvironmentSecretsCascade(environmentId: string): Promise<void> {
    await this.hydrateEnvironmentSecrets(environmentId)
    const meta = this.environmentMeta.get(environmentId)
    if (meta) {
      for (const childId of meta.childIds) {
        await this.hydrateEnvironmentSecretsCascade(childId)
      }
    }
  }

  /**
   * Refresh a secret wherever it is used as an env-folder variable: drop the
   * main-side resolution cache, blank the in-memory `resolved` plaintext, and
   * recompute the affected environment contexts so the secret — and any
   * expression composing it (e.g. `{{secret}}`) — goes empty IMMEDIATELY, then
   * re-hydrate asynchronously so the freshly fetched value flows back in.
   *
   * This is what the per-secret "refresh" button expects: invalidate → blank →
   * re-resolve, with the context preview reflecting the in-flight refresh
   * rather than holding the stale value.
   */
  refreshEnvSecret(source: string, params: Record<string, unknown>): void {
    secretHydrationService.invalidateAll(source, params)

    const target = canonicalStringify(params)
    const affected: string[] = []
    for (const [envId, meta] of this.environmentMeta) {
      let touched = false
      for (const kv of meta.rawVariables) {
        if (
          isSecretValue(kv.value) &&
          kv.value.source === source &&
          canonicalStringify(kv.value.params) === target
        ) {
          kv.value.resolved = undefined
          touched = true
        }
      }
      if (touched) affected.push(envId)
    }

    // Recompute now (secret blank) so the preview clears during the refresh,
    // then re-hydrate so the fresh value flows back once the resolver returns.
    for (const envId of affected) this.recalculateContextCascade(envId)
    for (const envId of affected) void this.hydrateEnvironmentSecretsCascade(envId)
  }

  /**
   * Recompute the transformed context for a request's active environment
   * chain and the request context itself. Called after env-folder secrets
   * have been hydrated, so the freshly-populated `SecretValue.resolved`
   * values flow into the context the executor reads.
   */
  refreshEnvironmentContext(requestId: string): void {
    const ctx = this.requestContexts.get(requestId)
    if (!ctx?.environmentId) return
    for (const envId of [...this.getParentChain(ctx.environmentId), ctx.environmentId]) {
      if (this.environmentMeta.has(envId)) this.recalculateContext(envId)
    }
    this.recalculateRequestContext(requestId)
  }

  /**
   * The request's OWN context: the transformed context of its selected
   * environment, or undefined when it has none.
   *
   * A run's values are never part of this. The only way a run's value reaches a
   * resolution is a `ResolutionContexts` the caller passes in explicitly and
   * then drops — see `composeResolutionContexts`.
   */
  private envContextFor(ctx: RequestContext): TransformedContext | undefined {
    return ctx.environmentId ? this.transformedContexts.get(ctx.environmentId) : undefined
  }

  /**
   * Resolve a single value against the request's context.
   *
   * `context` is the DISPOSABLE context of the row family this value belongs to
   * — `ResolutionContexts.base` for a value in no family (a payload, a topic, a
   * text body), `.headers` for a header, `.bodyFields` for a body field. Absent
   * (the request panel's Send, the display, an MCP dispatch outside a run) means
   * the request's own environment context, which is the right answer for those
   * callers and not a fallback.
   *
   * NOTE: this entry point doesn't know the value's `ValueType` so it always
   * runs the resolver — fine for body templates and the URL (which are
   * expression-shaped by construction) but WRONG for header / param
   * `KeyValue.value`, where a `StringValue` must stay verbatim. Header / param
   * resolution should use `resolveKeyValueForRequest` instead so the type-aware
   * gate in `resolveKeyValue` fires.
   */
  resolveValue(value: string, requestId: string, context?: TransformedContext): string {
    const effective = this.pickResolutionContext(requestId, context)
    if (!effective) return value
    return this.transformValue(value, effective)
  }

  /**
   * The context a resolution actually runs against: the caller's disposable one
   * when it carries anything, the request's own environment context otherwise.
   *
   * An EMPTY disposable context falls through rather than winning. A run with no
   * variables over a request with no environment resolves against nothing at
   * all, and "nothing at all" means the caller gets its template back verbatim —
   * the historical behaviour, which an empty-but-present object would silently
   * turn into "every variable resolves to the empty string".
   */
  private pickResolutionContext(requestId: string, context?: TransformedContext): TransformedContext | undefined {
    if (context && Object.keys(context).length > 0) return context
    const ctx = this.requestContexts.get(requestId)
    return ctx ? this.envContextFor(ctx) : undefined
  }

  /**
   * Resolve a request BODY. A body the Content-Type declares as JSON goes
   * through the JSON-aware resolver, which substitutes `{{ … }}` spans without
   * feeding the document's own braces to the Handlebars parser (so an unquoted
   * `{"id":{{petId}}}` resolves instead of failing to parse) and JSON-escapes
   * every value it injects inside a string. Any other Content-Type — XML, plain
   * text, none at all — keeps the raw whole-template substitution.
   *
   * Like `transformValue`, a resolution failure logs and returns the body
   * verbatim rather than shipping a half-substituted payload.
   */
  resolveBodyValue(value: string, requestId: string, contentType?: string, context?: TransformedContext): string {
    if (!isJsonContentType(contentType)) return this.resolveValue(value, requestId, context)
    const effective = this.pickResolutionContext(requestId, context)
    if (!effective) return value
    if (!value.includes('{{')) return value
    try {
      return resolveJsonBodyTemplate(value, effective)
    } catch (error) {
      logger.warn('[ContextService] JSON body transform error', {
        value,
        error: String(error)
      })
      return value
    }
  }

  /**
   * Type-aware resolution of a `KeyValue`. Only an `ExpressionValue`
   * runs through Handlebars; every other ValueType (StringValue,
   * SecretValue, …) is returned literally via `toString()`.
   * Mirrors `resolveKeyValue` but exposed publicly so HTTP / SOAP /
   * GraphQL execution services can opt into the strict gate
   * instead of the always-resolves shortcut.
   */
  resolveKeyValueForRequest(kv: KeyValue, requestId: string, context?: TransformedContext): string {
    // A CustomListValue carries a label; substitute the owning list's
    // current entry value (read live from the folder so edits to the
    // list are reflected on the next dispatch).
    if (isCustomListValue(kv.value)) {
      return this.resolveCustomListValue(kv.value, requestId)
    }
    // Multi-select: resolve each label and join (header / body context
    // can't repeat a key, so we comma-join — query params get the
    // repeated-key treatment in URLResolver via materialization).
    if (isCustomListMultiValue(kv.value)) {
      return this.resolveCustomListMultiValue(kv.value, requestId).join(',')
    }
    const effective = this.pickResolutionContext(requestId, context)
    if (!effective) return kv.value.toString()
    return this.resolveKeyValue(kv, effective)
  }

  /**
   * Resolve an environment variable's value to its context string.
   * Custom-list types substitute the selected label(s) for the current
   * entry value(s) from the owning folder's lists (read here, not via a
   * requestId walk, because env variables aren't request-scoped). Every
   * other type defers to `resolveKeyValue` (expression-aware gate).
   */
  private resolveEnvKeyValue(
    kv: KeyValue,
    context: TransformedContext,
    lists: CustomValueList[] | undefined
  ): string {
    if (isCustomListValue(kv.value)) {
      const value = kv.value
      const entry = lists
        ?.find((l) => l.id === value.listId)
        ?.entries.find((e) => e.label === value.label && e.enabled !== false)
      // No label fallback: an unresolvable custom value resolves to the
      // empty string so a missing / disabled entry can't masquerade as a
      // valid value (which it silently did when label === value).
      return entry?.value ?? ''
    }
    if (isCustomListMultiValue(kv.value)) {
      const value = kv.value
      const list = lists?.find((l) => l.id === value.listId)
      if (!list) return ''
      return value.labels
        .map((label) => list.entries.find((e) => e.label === label && e.enabled !== false)?.value)
        .filter((v): v is string => v !== undefined)
        .join(',')
    }
    return this.resolveKeyValue(kv, context)
  }

  private resolveCustomListValue(value: CustomListValue, requestId: string): string {
    const list = this.findCustomValueList(value.listId, requestId)
    // A disabled (unchecked) entry is treated as unavailable. No label
    // fallback: an unresolvable custom value resolves to the empty
    // string rather than leaking the label onto the wire (a label that
    // happened to equal its value silently masked broken resolution).
    const entry = list?.entries.find((e) => e.label === value.label && e.enabled !== false)
    return entry?.value ?? ''
  }

  /**
   * Resolve a multi-select CustomListMultiValue to the list of current
   * entry values for the selected labels. Labels whose entry is missing
   * or disabled are dropped (an unchecked value stops being sent). A
   * missing list resolves to no values — no label fallback.
   */
  private resolveCustomListMultiValue(value: CustomListMultiValue, requestId: string): string[] {
    const list = this.findCustomValueList(value.listId, requestId)
    if (!list) return []
    const resolved: string[] = []
    for (const label of value.labels) {
      const entry = list.entries.find((e) => e.label === label && e.enabled !== false)
      if (entry) resolved.push(entry.value)
    }
    return resolved
  }

  /**
   * Re-resolve everything affected by a custom-value-list edit on an
   * env-folder: the folder's environment contexts (env vars typed as a
   * custom list) and every registered request under the folder (params
   * / headers typed as a custom list). Reads the lists live from
   * `collectionStore`.
   *
   * Deliberately event-free — it must NOT route through
   * `collectionStore.updateFolder`, whose `FOLDER_UPDATED` /
   * `ENVIRONMENT_UPDATED` GraphQL publishes would spam the subscription
   * layer on every keystroke commit. Disk persistence + the renderer's
   * own reactivity are handled renderer-side; main only needs the fresh
   * lists for dispatch resolution.
   */
  recalculateForCustomListChange(folderId: string): void {
    const folder = collectionStore.findById(folderId)
    if (folder && isEnvironmentFolder(folder)) {
      const recalcEnvTree = (envs: Environment[]): void => {
        for (const env of envs) {
          if (this.environmentMeta.has(env.id)) this.recalculateContext(env.id)
          if (env.subEnvironments) recalcEnvTree(env.subEnvironments)
        }
      }
      recalcEnvTree(folder.environments)
    }
    for (const requestId of this.requestContexts.keys()) {
      if (this.isRequestUnderFolder(requestId, folderId)) {
        this.recalculateRequestContext(requestId)
      }
    }
  }

  /** True when `requestId`'s ancestor chain includes `folderId`. */
  private isRequestUnderFolder(requestId: string, folderId: string): boolean {
    let cursor: string | null = requestId
    for (let i = 0; i < MAX_ANCESTOR_WALK_DEPTH && cursor; i++) {
      const parent = collectionStore.findParentFolder(cursor)
      if (!parent) return false
      if (parent.id === folderId) return true
      cursor = parent.id
    }
    return false
  }

  /**
   * Walk up the request's ancestor chain to the nearest environment
   * folder and return the custom value list matching `listId` (read
   * live so edits reflect on the next dispatch).
   */
  private findCustomValueList(listId: string, requestId: string): CustomValueList | null {
    let cursor: string | null = requestId
    for (let i = 0; i < MAX_ANCESTOR_WALK_DEPTH && cursor; i++) {
      const parent = collectionStore.findParentFolder(cursor)
      if (!parent) break
      if (isEnvironmentFolder(parent)) {
        return parent.customValueLists?.find((l) => l.id === listId) ?? null
      }
      cursor = parent.id
    }
    return null
  }

  /**
   * Return a copy of `kvs` with every custom-list value materialised so
   * downstream resolvers (which only special-case enums) handle them:
   * - CustomListValue → resolved StringValue.
   * - CustomListMultiValue → EnumListValue of resolved values, which
   *   URLResolver repeats per value (collectionFormat: multi).
   */
  private materializeCustomListKVs(kvs: KeyValue[], requestId: string): KeyValue[] {
    if (!kvs.some((kv) => isCustomListValue(kv.value) || isCustomListMultiValue(kv.value))) return kvs
    return kvs.map((kv) => {
      if (isCustomListValue(kv.value)) {
        return new KeyValueModel({
          ...(kv.id !== undefined && { id: kv.id }),
          key: kv.key,
          value: new StringValue(this.resolveCustomListValue(kv.value, requestId)),
          ...(kv.description !== undefined && { description: kv.description }),
          enabled: kv.enabled ?? true
        })
      }
      if (isCustomListMultiValue(kv.value)) {
        return new KeyValueModel({
          ...(kv.id !== undefined && { id: kv.id }),
          key: kv.key,
          value: new EnumListValue(this.resolveCustomListMultiValue(kv.value, requestId), ''),
          ...(kv.description !== undefined && { description: kv.description }),
          enabled: kv.enabled ?? true
        })
      }
      return kv
    })
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
    // Abort every in-flight secret hydration so a slow resolver doesn't keep
    // running after the file is closed, then drop the resolution cache + the
    // spinner state.
    for (const aborter of this.envHydrationAborters.values()) aborter.abort()
    this.envHydrationAborters.clear()
    this.resolvingEnvironments.clear()
    this.erroredEnvironments.clear()
    // Per-item secret state.
    for (const aborter of this.itemHydrationAborters.values()) aborter.abort()
    this.itemHydrationAborters.clear()
    this.directResolvingItems.clear()
    this.directErroredItems.clear()
    this.knownItemIds.clear()
    this.itemEffectiveStatus.clear()
    this.resolvingEnvSecretVars.clear()
    this.erroredEnvSecretVars.clear()
    this.itemReferencedVars.clear()
    secretHydrationService.clearAll()
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
