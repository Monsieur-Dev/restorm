import { z } from 'zod/v4'

// ==========================================================================
// Shared primitives
// ==========================================================================

const requestIdArg = z.string()
const persistenceFormatArg = z.enum(['json', 'json5', 'yaml'])

const keyValueSchema = z.object({
  id: z.string().optional(),
  key: z.string(),
  value: z.string(),
  /**
   * Whether the value is an `ExpressionValue` and should be run
   * through the handlebars resolver at request time. Defaults to
   * `false` — a plain `StringValue` is sent verbatim. The renderer
   * derives this from the persisted `ValueType` subclass; main
   * reconstructs the right `ValueType` instance on receipt so the
   * resolver behaves consistently across the IPC boundary.
   */
  isExpression: z.boolean().optional(),
  /**
   * Set when the value is a custom-list selection. The flat `value`
   * string only carries the label; main rehydrates a `CustomListValue`
   * / `CustomListMultiValue` from these so the dispatch resolver can
   * substitute the entry value. Must live in the schema — zod strips
   * unknown keys, which would silently drop the type on the way in.
   */
  customList: z.object({ listId: z.string(), label: z.string() }).optional(),
  customListMulti: z.object({ listId: z.string(), labels: z.array(z.string()) }).optional(),
  enabled: z.boolean().optional()
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

// Refresh (invalidate the resolution cache) for one secret source + params.
// `scopeId` is optional: when omitted the cache entry is dropped across every
// scope (the renderer rarely knows the exact run scope).
export const secretsInvalidateArgs = z.tuple([
  z.object({
    source: z.string(),
    params: z.record(z.string(), z.unknown()),
    scopeId: z.string().optional()
  })
])

// Resolve-on-demand: read back a single secret's plaintext so the renderer can
// preview it (the user's own credential). Resolved value is returned to the
// renderer but is still NEVER written into the `.restorm` document.
export const secretsResolveArgs = z.tuple([
  z.object({
    source: z.string(),
    params: z.record(z.string(), z.unknown())
  })
])

// Refresh a secret used as an env-folder variable: drop the cache, blank the
// in-memory resolved value, recompute the affected env contexts (so the secret
// and any expression composing it go empty), then re-hydrate.
export const secretsRefreshArgs = z.tuple([
  z.object({
    source: z.string(),
    params: z.record(z.string(), z.unknown())
  })
])

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

export const contextGetEnvironmentContextArgs = z.tuple([z.string()])

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
    timeout: z.number().optional(),
    // Optional raw-body / URL overrides the OData path forwards through
    // http:execute (see HTTPExecutionInput).
    rawBody: z.string().optional(),
    rawBodyContentType: z.string().optional(),
    urlOverride: z.string().optional(),
    // Whether the executor follows 3xx redirects (defaults to true).
    followRedirects: z.boolean().optional(),
    // The renderer hands over the attached AuthenticationRequest as a
    // POJO; the handler re-validates it via isPlainAuthPayload +
    // AuthenticationRequest.fromPlain, so accept it as an opaque object
    // here (that guard stays authoritative) rather than a structural
    // schema. Enumerating it explicitly is what lets us drop `.loose()`.
    authRequest: z.unknown().optional()
  })
])

export const httpCancelArgs = z.tuple([requestIdArg])
export const httpIsActiveArgs = z.tuple([requestIdArg])
// HTTP mock server (server mode): start/stop hosting + listening check.
export const httpListenArgs = z.tuple([requestIdArg])
export const httpStopArgs = z.tuple([requestIdArg])
export const httpIsListeningArgs = z.tuple([requestIdArg])

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
    urlOverride: z.string().optional(),
    /** Attached AuthenticationRequest POJO — re-validated in the handler
     * via isPlainAuthPayload + fromPlain (that guard stays
     * authoritative), so opaque here. */
    authRequest: z.unknown().optional()
  })
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
  })
])

// ==========================================================================
// GraphQL Execution
// ==========================================================================

export const graphqlExecuteArgs = z.tuple([
  z.object({
    requestId: z.string(),
    timeout: z.number().optional()
  })
])

export const graphqlCancelArgs = z.tuple([requestIdArg])
export const graphqlIsActiveArgs = z.tuple([requestIdArg])
// GraphQL mock server (server mode): start/stop hosting + listening check.
export const graphqlListenArgs = z.tuple([requestIdArg])
export const graphqlStopArgs = z.tuple([requestIdArg])
export const graphqlIsListeningArgs = z.tuple([requestIdArg])

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
export const soapListenArgs = z.tuple([requestIdArg])
export const soapStopArgs = z.tuple([requestIdArg])
export const soapIsListeningArgs = z.tuple([requestIdArg])

// ==========================================================================
// gRPC Execution
// ==========================================================================

export const grpcExecuteArgs = z.tuple([
  z.object({
    requestId: z.string(),
    timeout: z.number().optional()
  }).loose()
])

export const grpcConnectArgs = z.tuple([
  z.object({
    requestId: z.string(),
    timeout: z.number().optional()
  }).loose()
])
export const grpcSendArgs = z.tuple([requestIdArg, z.string()])
export const grpcDisconnectArgs = z.tuple([requestIdArg])
export const grpcCancelArgs = z.tuple([requestIdArg])
export const grpcIsActiveArgs = z.tuple([requestIdArg])
// gRPC mock server (server mode): start/stop hosting + listening check.
export const grpcListenArgs = z.tuple([requestIdArg])
export const grpcStopArgs = z.tuple([requestIdArg])
export const grpcIsListeningArgs = z.tuple([requestIdArg])

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

// ==========================================================================
// Request Usage
// ==========================================================================

export const requestUsageGetArgs = z.tuple([])
export const scenarioUsageGetArgs = z.tuple([])

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
// API Update (per-folder on-demand spec re-import)
// ==========================================================================

// `apiUpdate:set-settings` is a PATCH operation — the IPC handler
// passes the payload straight to `updateFolderConfig` which spreads
// it into the existing `apiUpdate` config. Every field is optional
// so partial patches (e.g. `{ sourceHeaders }` from the Refresh
// flow, or `{ lastCheckedAt }` after a checksum check) are accepted
// without forcing the caller to read the whole config first.
const apiUpdateConfigSchema = z.object({
  sourceUrl: z.string().optional(),
  sourceHeaders: z.record(z.string(), z.string()).optional(),
  lastCheckedAt: z.number().optional(),
  lastImportedAt: z.number().optional(),
  payloadChecksum: z.string().optional(),
  authenticationRequestId: z.string().optional()
})

const folderIdArg = z.string()

export const apiUpdateSetSettingsArgs = z.tuple([folderIdArg, apiUpdateConfigSchema])
export const apiUpdateApplyArgs = z.tuple([
  folderIdArg,
  z.object({
    include: z.array(z.string()),
    skip: z.array(z.string())
  }).optional()
])
export const apiUpdateRefreshFetchArgs = z.tuple([folderIdArg])

/** Renderer → main sync of the loaded collections so main-side
 * services (apiUpdate apply / preview) can resolve folder ids
 * without reaching back through IPC. The renderer is the source of
 * truth for the project tree; this handler just mirrors it into the
 * main-side CollectionStore. */
/** Each synced collection node must at least be a non-null OBJECT (not a
 * primitive / null / array). This rejects a malformed or hostile renderer
 * payload before it reaches `setCollections` — the audit flagged this as the
 * renderer-controlled source-of-truth that ultimately drives the apiUpdate
 * SSRF sourceUrl, so it shouldn't be a bare `z.unknown()`. We deliberately do
 * NOT enumerate fields (no required `id`): the tree carries many node shapes
 * (folder / env-folder / request / scenario, plus reactive clones) and the
 * store's reify path owns the rich validation. `.loose()` keeps every field. */
const syncedCollectionNode = z.object({}).loose()
export const collectionsSyncArgs = z.tuple([z.array(syncedCollectionNode)])

/** `[folderId, customValueLists]` — targeted update of one env-folder's
 * custom value lists. Lists pass through as `unknown` (no strip) so the
 * entries survive intact for the dispatch resolver. */
export const collectionsUpdateFolderCustomValueListsArgs = z.tuple([z.string(), z.array(z.unknown())])

// ==========================================================================
// MiniBrowser — main-process `WebContentsView` lifecycle
// ==========================================================================

const tabIdArg = z.string()
const miniBrowserBoundsSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number()
})

/** Only http(s) URLs may be embedded; empty string = "no initial URL". */
const httpUrlOrEmpty = z.string().refine(
  (v) => v === '' || /^https?:\/\//i.test(v),
  { message: 'mini-browser URL must be http(s)' }
)

export const miniBrowserCreateArgs = z.tuple([tabIdArg, httpUrlOrEmpty.optional()])
export const miniBrowserDestroyArgs = z.tuple([tabIdArg])
export const miniBrowserSetBoundsArgs = z.tuple([tabIdArg, miniBrowserBoundsSchema])
export const miniBrowserNavigateArgs = z.tuple([tabIdArg, httpUrlOrEmpty])
export const miniBrowserReloadArgs = z.tuple([tabIdArg])
export const miniBrowserGoBackArgs = z.tuple([tabIdArg])
export const miniBrowserGoForwardArgs = z.tuple([tabIdArg])
export const miniBrowserGetStateArgs = z.tuple([tabIdArg])
export const miniBrowserCaptureArgs = z.tuple([tabIdArg])

// ==========================================================================
// OUTPUT (return-shape) schemas — preload defense-in-depth
// --------------------------------------------------------------------------
// These validate what main sends BACK to the renderer on externally-sourced
// bridges (import pipeline, spec fetches, HTTP/WS/gRPC response envelopes).
// For hot execute paths the check is envelope-shape-only — the body string
// is arbitrary external content and must NOT be re-parsed.
// Failure mode in the preload: warn-only (never throw on mismatch so a
// schema drift never breaks a live request flow).
// ==========================================================================

const timingsSchema = z.object({ startedAt: z.string(), durationMs: z.number() })

export const httpExecuteResultSchema = z.object({
  requestId: z.string(),
  success: z.boolean(),
  statusCode: z.number().optional(),
  statusText: z.string().optional(),
  headers: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
  body: z.string().optional(),
  error: z.string().optional(),
  timings: timingsSchema,
  requestUrl: z.string().optional(),
  requestHeaders: z.record(z.string(), z.string()).optional(),
})

export const graphqlExecuteResultSchema = z.object({
  requestId: z.string(),
  success: z.boolean(),
  statusCode: z.number().optional(),
  statusText: z.string().optional(),
  headers: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
  body: z.string().optional(),
  error: z.string().optional(),
  timings: timingsSchema,
})

export const soapExecuteResultSchema = z.object({
  requestId: z.string(),
  success: z.boolean(),
  statusCode: z.number().optional(),
  statusText: z.string().optional(),
  headers: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
  body: z.string().optional(),
  error: z.string().optional(),
  timings: timingsSchema,
})

export const grpcExecuteResultSchema = z.object({
  requestId: z.string(),
  success: z.boolean(),
  statusCode: z.number().optional(),
  statusMessage: z.string().optional(),
  body: z.string().optional(),
  error: z.string().optional(),
  timings: timingsSchema,
})

export const websocketConnectResultSchema = z.object({
  requestId: z.string(),
  success: z.boolean(),
  error: z.string().optional(),
})

export const authPrefetchResultSchema = z.object({
  requestId: z.string(),
  success: z.boolean(),
  error: z.string().optional(),
})

export const importPreviewResultSchema = z.object({
  items: z.array(z.looseObject({ name: z.string() })),
})

export const importImportResultSchema = z.object({
  imported: z.number(),
})

export const apiUpdateRefreshFetchResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), spec: z.string() }),
  z.object({ ok: z.literal(false), error: z.string() }),
])
