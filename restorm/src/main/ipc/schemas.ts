import { z } from 'zod/v4'

// ==========================================================================
// Shared primitives
// ==========================================================================

const requestIdArg = z.string()
const persistenceFormatArg = z.enum(['json', 'json5', 'yaml'])

const keyValueSchema = z.object({
  id: z.string().optional(),
  key: z.string(),
  value: z.string()
})

// ==========================================================================
// Editor Window
// ==========================================================================

export const openEditorArgs = z.tuple([
  z.object({
    title: z.string(),
    content: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional()
  }).optional()
])

// ==========================================================================
// File Save
// ==========================================================================

export const saveAsFileArgs = z.tuple([z.unknown(), persistenceFormatArg])

export const saveAsFolderArgs = z.tuple([
  z.unknown(),
  persistenceFormatArg,
  z.string().optional()
])

// ==========================================================================
// Secrets
// ==========================================================================

export const secretsReadArgs = z.tuple([z.string()])
export const secretsWriteArgs = z.tuple([z.string(), z.string()])

// ==========================================================================
// Open Path
// ==========================================================================

export const openPathArgs = z.tuple([z.string()])

// ==========================================================================
// Project Files
// ==========================================================================

export const projectReadFileArgs = z.tuple([z.string()])

// ==========================================================================
// Context Service
// ==========================================================================

export const contextRegisterRequestArgs = z.tuple([
  requestIdArg,
  z.string().nullable(),
  z.object({
    headers: z.array(keyValueSchema).optional(),
    params: z.array(keyValueSchema).optional(),
    pathParams: z.array(keyValueSchema).optional()
  })
])

export const contextUnregisterRequestArgs = z.tuple([requestIdArg])

export const contextSetRequestEnvironmentArgs = z.tuple([
  requestIdArg,
  z.string().nullable()
])

export const contextSetAvailableEnvironmentsArgs = z.tuple([
  requestIdArg,
  z.array(z.string())
])

export const contextUpdateRequestKeyValuesArgs = z.tuple([
  requestIdArg,
  z.string(),
  z.array(keyValueSchema),
  z.string().optional()
])

export const contextUpdateFullRequestDataArgs = z.tuple([
  requestIdArg,
  z.unknown(),
  z.string().optional()
])

export const contextGetResolvedUrlArgs = z.tuple([requestIdArg])
export const contextGetCodeSnippetsArgs = z.tuple([requestIdArg])

// ==========================================================================
// Request Service
// ==========================================================================

export const requestResolveUrlArgs = z.tuple([
  z.object({
    urlTemplate: z.string(),
    pathParams: z.array(keyValueSchema),
    queryParams: z.array(keyValueSchema),
    environmentContext: z.record(z.string(), z.string())
  })
])

// ==========================================================================
// HTTP Execution
// ==========================================================================

export const httpExecuteArgs = z.tuple([
  z.object({
    requestId: z.string(),
    method: z.string(),
    timeout: z.number().optional()
  }).loose()
])

export const httpCancelArgs = z.tuple([requestIdArg])
export const httpIsActiveArgs = z.tuple([requestIdArg])

// ==========================================================================
// OData Execution (reuses httpExecutionService under the hood)
// ==========================================================================

export const odataExecuteArgs = z.tuple([
  z.object({
    requestId: z.string(),
    timeout: z.number().optional(),
    /** Optional HTTP method — defaults to GET. `POST` is used for
     * OData action and $batch invocations. */
    method: z.string().optional(),
    /** Optional request body — raw string. For actions this is the
     * JSON payload; for $batch this is the pre-assembled
     * multipart/mixed envelope. Env-templated before dispatch. */
    body: z.string().optional(),
    /** Optional Content-Type override for the body — required for
     * $batch to carry the multipart boundary. Defaults to
     * `application/json`. */
    bodyContentType: z.string().optional(),
    /** Optional absolute URL override. When provided the engine
     * dispatches to that URL verbatim instead of composing one from
     * the registered request. Used for `@odata.nextLink` pagination
     * and clickable navigation links. */
    urlOverride: z.string().optional()
  }).loose()
])

export const odataCancelArgs = z.tuple([requestIdArg])
export const odataIsActiveArgs = z.tuple([requestIdArg])

// ==========================================================================
// Authentication routes
// --------------------------------------------------------------------------
// `auth:prefetch` runs an ephemeral AuthenticationRequest (typically
// the one being edited in the import wizard modal), evaluates its
// producedHeaders against the response body, and returns the
// resolved header map. Used so the import screen can drive a retry
// with the auth headers attached without the auth request having to
// be persisted first.
// ==========================================================================

export const authPrefetchArgs = z.tuple([
  z.object({
    method: z.string(),
    url: z.string(),
    headers: z.array(z.object({
      key: z.string(),
      value: z.string(),
      enabled: z.boolean().optional()
    })).optional(),
    body: z.object({
      type: z.string(),
      content: z.string().optional(),
      fields: z.array(z.object({
        key: z.string(),
        value: z.string(),
        enabled: z.boolean().optional()
      })).optional()
    }).optional(),
    producedHeaders: z.array(z.object({
      key: z.string(),
      value: z.string(),
      enabled: z.boolean().optional()
    })),
    expirationExpression: z.string().optional()
  }).loose()
])

// ==========================================================================
// GraphQL Execution
// ==========================================================================

export const graphqlExecuteArgs = z.tuple([
  z.object({
    requestId: z.string(),
    timeout: z.number().optional()
  }).loose()
])

export const graphqlCancelArgs = z.tuple([requestIdArg])
export const graphqlIsActiveArgs = z.tuple([requestIdArg])

// ==========================================================================
// SOAP Execution
// ==========================================================================

export const soapExecuteArgs = z.tuple([
  z.object({
    requestId: z.string(),
    timeout: z.number().optional()
  }).loose()
])

export const soapCancelArgs = z.tuple([requestIdArg])
export const soapIsActiveArgs = z.tuple([requestIdArg])

// ==========================================================================
// gRPC Execution
// ==========================================================================

export const grpcExecuteArgs = z.tuple([
  z.object({
    requestId: z.string(),
    timeout: z.number().optional()
  }).loose()
])

export const grpcCancelArgs = z.tuple([requestIdArg])
export const grpcIsActiveArgs = z.tuple([requestIdArg])

// ==========================================================================
// WebSocket Execution
// ==========================================================================

export const websocketConnectArgs = z.tuple([
  z.object({
    requestId: z.string(),
    timeout: z.number().optional()
  }).loose()
])

export const websocketDisconnectArgs = z.tuple([requestIdArg])
export const websocketSendArgs = z.tuple([
  requestIdArg,
  z.string(),
  z.string().optional()
])
export const websocketIsActiveArgs = z.tuple([requestIdArg])

// ==========================================================================
// Responses History
// ==========================================================================

export const responsesHistoryListArgs = z.tuple([requestIdArg])
export const responsesHistoryGetArgs = z.tuple([z.string()])
export const responsesHistoryTogglePinArgs = z.tuple([z.string(), z.boolean()])
export const responsesHistoryUpdatePathArgs = z.tuple([
  requestIdArg,
  z.string()
])

// ==========================================================================
// Import
// ==========================================================================

export const importPreviewArgs = z.tuple([
  z.string(),
  z.object({
    /** Optional extra headers merged into the URL-based import fetch
     * (resolved auth headers after running an AuthenticationRequest). */
    extraHeaders: z.record(z.string(), z.string()).optional()
  }).optional()
])
export const importImportArgs = z.tuple([z.string()])

// ==========================================================================
// Documentation Compiler
// ==========================================================================

const routeLikeSchema = z.object({
  type: z.enum(['http', 'graphql', 'grpc', 'soap', 'websocket']),
  url: z.string().optional(),
  method: z.string().optional(),
  operationType: z.string().optional(),
  query: z.string().optional(),
  service: z.string().optional(),
  rpcMethod: z.string().optional(),
  soapAction: z.string().optional(),
  operation: z.string().optional(),
  event: z.string().optional(),
  protocol: z.string().optional(),
  tags: z.array(z.string()).optional()
})

/** ApiDocumentation arrives as an opaque JSON object; shape is validated by the consumer. */
export const docsCompileRouteArgs = z.tuple([z.unknown(), routeLikeSchema])
export const docsCompileRootArgs = z.tuple([z.unknown()])

// ==========================================================================
// API Update (per-folder periodic spec re-check)
// ==========================================================================

const apiUpdateConfigSchema = z.object({
  sourceUrl: z.string(),
  sourceHeaders: z.record(z.string(), z.string()).optional(),
  autoCheckEnabled: z.boolean(),
  interval: z.enum(['hourly', 'every6h', 'daily', 'weekly', 'never']),
  lastCheckedAt: z.number().optional(),
  lastImportedSpecVersion: z.string().optional(),
  lastImportedSpecHash: z.string().optional()
})

const folderIdArg = z.string()

export const apiUpdateGetStateArgs = z.tuple([folderIdArg])
export const apiUpdateGetSnapshotArgs = z.tuple([])
export const apiUpdateSetSettingsArgs = z.tuple([folderIdArg, apiUpdateConfigSchema])
export const apiUpdateCheckNowArgs = z.tuple([folderIdArg])
export const apiUpdateApplyArgs = z.tuple([folderIdArg])
export const apiUpdateDismissArgs = z.tuple([folderIdArg])
export const apiUpdatePreviewArgs = z.tuple([folderIdArg])
export const apiUpdateRefreshDiffArgs = z.tuple([folderIdArg])
