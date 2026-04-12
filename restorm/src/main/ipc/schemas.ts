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

export const contextUpdateRequestKeyValuesArgs = z.tuple([
  requestIdArg,
  z.string(),
  z.array(keyValueSchema)
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

export const importPreviewArgs = z.tuple([z.string()])
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
