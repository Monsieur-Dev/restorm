/**
 * ContextService - Manages Handlebars context, URL resolution and code snippets (Main Process)
 *
 * Listens to document events from the EventBus and maintains:
 * - Data objects needed for Handlebars resolution
 * - Resolved variable values per environment
 * - Resolved URLs for each request
 * - Generated code snippets for each request
 *
 * Runs in the main process to avoid blocking the UI.
 */

import { BrowserWindow, app } from 'electron'
import Handlebars from 'handlebars'
import * as fs from 'fs'
import * as path from 'path'
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

// ============================================================================
// Types and Interfaces
// ============================================================================

/** KeyValue structure from environment */
interface KeyValue {
  id?: string
  key: string
  value: string
  description?: string
  /** Whether this key-value is enabled (default: true) */
  enabled?: boolean
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

/** HTTP request body types */
type HTTPRequestBody =
  | { type: 'text'; content: string }
  | { type: 'file'; path: string }
  | { type: 'form-data'; fields: KeyValue[] }
  | { type: 'x-www-form-urlencoded'; fields: KeyValue[] }

/** Full request data for URL resolution and code snippet generation */
export interface FullRequestData {
  id: string
  requestType: 'http' | 'graphql' | 'grpc' | 'soap' | 'websocket'
  
  // Common fields
  url: string
  headers: KeyValue[]
  
  // HTTP specific
  method?: string
  params?: KeyValue[]
  pathParams?: KeyValue[]
  body?: HTTPRequestBody
  
  // GraphQL specific
  operationType?: string
  query?: string
  variables?: string
  
  // gRPC specific
  service?: string
  grpcMethod?: string
  callType?: string
  requestMessage?: string
  metadata?: KeyValue[]
  
  // SOAP specific
  soapAction?: string
  soapService?: string
  operation?: string
  soapBody?: string
  
  // WebSocket specific
  protocol?: string
  event?: string
  message?: string
}

/** Request context tracking with full data */
interface RequestContext {
  /** Selected environment ID (null if no environment) */
  environmentId: string | null
  /** Request KeyValues to transform (headers, params, pathParams, etc.) */
  keyValueGroups: Map<string, KeyValue[]>
  /** Full request data for URL and code snippet generation */
  fullData: FullRequestData | null
}

/** Resolved URL result */
export interface ResolvedUrlResult {
  /** The final resolved URL */
  resolvedUrl: string
  /** Base URL without query string */
  baseUrl: string
  /** Query string (without leading ?) */
  queryString: string
}

/** Code snippets result */
export interface CodeSnippetsResult {
  /** Generated markdown content with code snippets */
  markdown: string
}

/** Request structure (minimal for context service - legacy) */
interface RequestData {
  id: string
  headers?: KeyValue[]
  params?: KeyValue[]
  pathParams?: KeyValue[]
}

// ============================================================================
// Code Snippet Templates loading
// ============================================================================

/**
 * Get the path to template files.
 * In development, templates are copied to dist/main/resources/templates/
 * In production, they're bundled with the app.
 */
function getTemplatesPath(): string {
  // Check if running in development or production
  if (app.isPackaged) {
    // In production, templates are in resources/app.asar/dist/main/resources/templates
    return path.join(process.resourcesPath, 'app.asar', 'dist', 'main', 'resources', 'templates')
  }
  // In development, __dirname is dist/main/, templates are in dist/main/resources/templates/
  return path.join(__dirname, 'resources', 'templates')
}

/**
 * Load a template file and return its contents
 */
function loadTemplate(templateName: string): string {
  const templatesPath = getTemplatesPath()
  const templatePath = path.join(templatesPath, templateName)
  
  try {
    return fs.readFileSync(templatePath, 'utf-8')
  } catch (error) {
    logger.error('[ContextService] Failed to load template', { templateName, templatePath, error: String(error) })
    return ''
  }
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
  private httpSnippetTemplate: Handlebars.TemplateDelegate | null = null
  private graphqlSnippetTemplate: Handlebars.TemplateDelegate | null = null
  private websocketSnippetTemplate: Handlebars.TemplateDelegate | null = null
  private grpcSnippetTemplate: Handlebars.TemplateDelegate | null = null
  private soapSnippetTemplate: Handlebars.TemplateDelegate | null = null

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
    try {
      const httpTemplate = loadTemplate('code-snippets-httprequests.hbs')
      const graphqlTemplate = loadTemplate('code-snippets-graphql.hbs')
      const websocketTemplate = loadTemplate('code-snippets-websocket.hbs')
      const grpcTemplate = loadTemplate('code-snippets-grpc.hbs')
      const soapTemplate = loadTemplate('code-snippets-soap.hbs')
      
      if (httpTemplate) this.httpSnippetTemplate = Handlebars.compile(httpTemplate, { noEscape: true })
      if (graphqlTemplate) this.graphqlSnippetTemplate = Handlebars.compile(graphqlTemplate, { noEscape: true })
      if (websocketTemplate) this.websocketSnippetTemplate = Handlebars.compile(websocketTemplate, { noEscape: true })
      if (grpcTemplate) this.grpcSnippetTemplate = Handlebars.compile(grpcTemplate, { noEscape: true })
      if (soapTemplate) this.soapSnippetTemplate = Handlebars.compile(soapTemplate, { noEscape: true })
      
      logger.info('[ContextService] Code snippet templates loaded and compiled')
    } catch (error) {
      logger.error('[ContextService] Failed to compile code snippet templates', { error: String(error) })
    }

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
  updateFullRequestData(requestId: string, data: FullRequestData): void {
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

    // Recalculate everything
    this.recalculateRequestContext(requestId)
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
        // Skip disabled variables (enabled defaults to true if undefined)
        if (kv.enabled === false) {
          continue
        }
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
        variableCount: keyValues.filter(kv => kv.id && kv.enabled !== false).length
      })
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
      this.calculateResolvedUrl(requestId, updatedData, baseContext)
      this.calculateCodeSnippets(requestId, updatedData, baseContext)
      this.calculateAvailableVariables(requestId, updatedData, baseContext)
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
    envContext: TransformedContext
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
        this.broadcastFieldVariables(pp.id, varsForThisField)
      }
      
      if (pp.key && pp.key.trim() !== '') {
        const contextForResolve: TransformedContext = { ...envContext }
        for (const prev of cumulativePathParams) {
          contextForResolve[prev.name] = prev.value
        }
        const resolvedValue = this.transformValue(pp.value, contextForResolve)
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
        this.broadcastFieldVariables(h.id, varsForThisField)
      }
      
      if (h.key && h.key.trim() !== '') {
        const contextForResolve: TransformedContext = { ...envContext }
        for (const prev of cumulativeHeaders) {
          contextForResolve[prev.name] = prev.value
        }
        const resolvedValue = this.transformValue(h.value, contextForResolve)
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
        this.broadcastFieldVariables(p.id, varsForThisField)
      }
      
      if (p.key && p.key.trim() !== '') {
        const contextForResolve: TransformedContext = { ...envContext }
        for (const prev of cumulativeParams) {
          contextForResolve[prev.name] = prev.value
        }
        const resolvedValue = this.transformValue(p.value, contextForResolve)
        addOrReplace(cumulativeParams, p.key, resolvedValue)
      }
    }

    // URL field gets env + ALL path params
    const urlVariableId = `${requestId}:url`
    const urlVars = [...envVars, ...cumulativePathParams]
    this.broadcastFieldVariables(urlVariableId, urlVars)
  }

  /**
   * Broadcast available variables for a specific field
   */
  private broadcastFieldVariables(
    variableId: string,
    variables: { name: string; value: string }[]
  ): void {
    const previous = this.availableVariablesPerField.get(variableId)
    const hasChanged = !previous ||
      previous.length !== variables.length ||
      variables.some((v, i) => {
        const prevItem = previous[i]
        return prevItem && (prevItem.name !== v.name || prevItem.value !== v.value)
      })

    if (hasChanged) {
      this.availableVariablesPerField.set(variableId, variables)
      this.broadcastToRenderer('context:available-variables', { variableId, variables })
    }
  }

  // =========================================================================
  // URL Resolution
  // =========================================================================

  /**
   * Calculate the resolved URL for a request
   */
  private calculateResolvedUrl(requestId: string, data: FullRequestData, envContext: TransformedContext): void {
    // Build cumulative context with path params (non-encoded for resolution)
    const cumulativeContext = { ...envContext }
    const pathParams = data.pathParams ?? []
    
    for (const pp of pathParams) {
      // Skip disabled path params (enabled defaults to true if undefined)
      if (pp.enabled === false) {
        continue
      }
      if (pp.key) {
        // Resolve using cumulative context (env + previous path params)
        const resolvedKey = this.transformValue(pp.key, cumulativeContext)
        const resolvedValue = this.transformValue(pp.value, cumulativeContext)
        // Store non-encoded value for next iterations (last value wins for same key)
        cumulativeContext[resolvedKey] = resolvedValue
      }
    }
    
    // Build URL context with URL-encoded values
    const fullContext = { ...envContext }
    for (const [key, value] of Object.entries(cumulativeContext)) {
      if (!(key in envContext)) {
        // Only encode path param values, not env values
        fullContext[key] = encodeURIComponent(value)
      }
    }

    // Transform the URL template
    const baseUrl = this.transformValue(data.url, fullContext)

    // Build query string from params with cumulative resolution
    const params = data.params ?? []
    const cumulativeParamsContext = { ...envContext }
    const resolvedParams = new Map<string, string>() // key -> resolved value (last wins)
    
    for (const param of params) {
      // Skip disabled params (enabled defaults to true if undefined)
      if (param.enabled === false) {
        continue
      }
      if (param.key) {
        // Resolve using cumulative context
        const resolvedKey = this.transformValue(param.key, cumulativeParamsContext)
        const resolvedValue = this.transformValue(param.value, cumulativeParamsContext)
        // Store for URL (last value wins for same key)
        resolvedParams.set(resolvedKey, resolvedValue)
        // Add to cumulative context for next params
        cumulativeParamsContext[resolvedKey] = resolvedValue
      }
    }
    
    const queryParts: string[] = []
    for (const [key, value] of resolvedParams) {
      queryParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    }
    const queryString = queryParts.join('&')

    // Combine base URL and query string
    let resolvedUrl = baseUrl
    if (queryString) {
      // Determine separator: ?, &, or nothing
      if (baseUrl.endsWith('?') || baseUrl.endsWith('&')) {
        resolvedUrl = baseUrl + queryString
      } else if (baseUrl.includes('?')) {
        resolvedUrl = baseUrl + '&' + queryString
      } else {
        resolvedUrl = baseUrl + '?' + queryString
      }
    }

    const result: ResolvedUrlResult = {
      resolvedUrl,
      baseUrl,
      queryString
    }

    // Store and broadcast
    const previousResult = this.resolvedUrls.get(requestId)
    if (!previousResult || previousResult.resolvedUrl !== result.resolvedUrl) {
      this.resolvedUrls.set(requestId, result)
      this.broadcastToRenderer('context:url-resolved', { requestId, ...result })
      logger.debug('[ContextService] URL resolved', { requestId, resolvedUrl })
    }
  }

  // =========================================================================
  // Code Snippets Generation
  // =========================================================================

  /**
   * Calculate code snippets for a request
   */
  private calculateCodeSnippets(requestId: string, data: FullRequestData, envContext: TransformedContext): void {
    let markdown = ''

    // Get resolved URL
    const urlResult = this.resolvedUrls.get(requestId)
    const resolvedUrl = urlResult?.resolvedUrl ?? this.transformValue(data.url, envContext)

    // Parse URL components
    let host = ''
    let path = '/'
    try {
      const urlObj = new URL(resolvedUrl.startsWith('http') ? resolvedUrl : `https://${resolvedUrl}`)
      host = urlObj.host
      path = urlObj.pathname + urlObj.search
    } catch {
      host = resolvedUrl
    }

    // Resolve headers (skip disabled ones)
    const headers = data.headers
      .filter(h => h.key && h.enabled !== false)
      .map(h => ({
        key: this.transformValue(h.key, envContext),
        value: this.transformValue(h.value, envContext)
      }))

    switch (data.requestType) {
      case 'http': {
        const method = data.method ?? 'GET'
        let body: string | null = null

        // Resolve body
        if (data.body) {
          switch (data.body.type) {
            case 'text':
              body = this.transformValue(data.body.content, envContext)
              break
            case 'form-data':
            case 'x-www-form-urlencoded':
              body = data.body.fields
                .filter(f => f.key)
                .map(f => `${encodeURIComponent(f.key)}=${encodeURIComponent(this.transformValue(f.value, envContext))}`)
                .join('&')
              break
          }
        }

        if (this.httpSnippetTemplate) {
          markdown = this.httpSnippetTemplate({
            method,
            lowerMethod: method.toLowerCase(),
            url: resolvedUrl,
            host,
            path,
            headers: headers.length > 0 ? headers : null,
            body
          })
        }
        break
      }

      case 'graphql': {
        const query = data.query ?? ''
        const variables = data.variables ?? ''
        const escapedQuery = query.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')

        if (this.graphqlSnippetTemplate) {
          markdown = this.graphqlSnippetTemplate({
            url: resolvedUrl,
            query,
            escapedQuery,
            variables: variables || null,
            headers: headers.length > 0 ? headers : null
          })
        }
        break
      }

      case 'websocket': {
        const message = data.message ? this.transformValue(data.message, envContext) : ''

        if (this.websocketSnippetTemplate) {
          markdown = this.websocketSnippetTemplate({
            url: resolvedUrl,
            protocol: data.protocol ?? 'websocket',
            event: data.event ?? '',
            message: message || null
          })
        }
        break
      }

      case 'grpc': {
        const requestMessage = data.requestMessage ? this.transformValue(data.requestMessage, envContext) : '{}'
        const metadata = (data.metadata ?? [])
          .filter(m => m.key)
          .map(m => ({
            key: this.transformValue(m.key, envContext),
            value: this.transformValue(m.value, envContext)
          }))

        if (this.grpcSnippetTemplate) {
          markdown = this.grpcSnippetTemplate({
            host,
            service: data.service ?? '',
            method: data.grpcMethod ?? '',
            callType: data.callType ?? 'unary',
            requestMessage,
            metadata: metadata.length > 0 ? metadata : null
          })
        }
        break
      }

      case 'soap': {
        const soapBody = data.soapBody ? this.transformValue(data.soapBody, envContext) : ''

        if (this.soapSnippetTemplate) {
          markdown = this.soapSnippetTemplate({
            url: resolvedUrl,
            soapAction: data.soapAction ?? '',
            service: data.soapService ?? '',
            operation: data.operation ?? '',
            body: soapBody,
            headers: headers.length > 0 ? headers : null
          })
        }
        break
      }
    }

    const result: CodeSnippetsResult = { markdown }

    // Store and broadcast
    const previousResult = this.codeSnippets.get(requestId)
    if (!previousResult || previousResult.markdown !== result.markdown) {
      this.codeSnippets.set(requestId, result)
      this.broadcastToRenderer('context:code-snippets-updated', { requestId, ...result })
      logger.debug('[ContextService] Code snippets generated', { requestId, length: markdown.length })
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
        logger.debug('[ContextService] Recalculating request due to environment change', {
          requestId,
          environmentId: ctx.environmentId
        })
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
