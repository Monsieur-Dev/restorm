/**
 * CodeSnippetGenerator - Generates code snippets for HTTP, GraphQL, WebSocket, gRPC and SOAP requests
 *
 * Extracted from ContextService to isolate code snippet generation logic.
 */

import Handlebars from 'handlebars'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { logger } from 'electron-core-ui/main'
import type {
  CodeSnippetsResult,
  FullRequestData,
  ResolvedUrlResult,
  TransformedContext,
  TransformValueFn
} from './ContextServiceTypes'

// ============================================================================
// Template Loading
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
    logger.error('[CodeSnippetGenerator] Failed to load template', { templateName, templatePath, error: String(error) })
    return ''
  }
}

// ============================================================================
// Compiled Templates
// ============================================================================

export interface CompiledSnippetTemplates {
  httpSnippetTemplate: Handlebars.TemplateDelegate | null
  graphqlSnippetTemplate: Handlebars.TemplateDelegate | null
  websocketSnippetTemplate: Handlebars.TemplateDelegate | null
  grpcSnippetTemplate: Handlebars.TemplateDelegate | null
  soapSnippetTemplate: Handlebars.TemplateDelegate | null
}

/**
 * Load and compile all code snippet Handlebars templates.
 * Should be called once during service initialization (after registerHandlebarsHelpers).
 */
export function compileSnippetTemplates(): CompiledSnippetTemplates {
  const templates: CompiledSnippetTemplates = {
    httpSnippetTemplate: null,
    graphqlSnippetTemplate: null,
    websocketSnippetTemplate: null,
    grpcSnippetTemplate: null,
    soapSnippetTemplate: null
  }

  try {
    const httpTemplate = loadTemplate('code-snippets-httprequests.hbs')
    const graphqlTemplate = loadTemplate('code-snippets-graphql.hbs')
    const websocketTemplate = loadTemplate('code-snippets-websocket.hbs')
    const grpcTemplate = loadTemplate('code-snippets-grpc.hbs')
    const soapTemplate = loadTemplate('code-snippets-soap.hbs')

    if (httpTemplate) templates.httpSnippetTemplate = Handlebars.compile(httpTemplate, { noEscape: true })
    if (graphqlTemplate) templates.graphqlSnippetTemplate = Handlebars.compile(graphqlTemplate, { noEscape: true })
    if (websocketTemplate) templates.websocketSnippetTemplate = Handlebars.compile(websocketTemplate, { noEscape: true })
    if (grpcTemplate) templates.grpcSnippetTemplate = Handlebars.compile(grpcTemplate, { noEscape: true })
    if (soapTemplate) templates.soapSnippetTemplate = Handlebars.compile(soapTemplate, { noEscape: true })

    logger.info('[CodeSnippetGenerator] Code snippet templates loaded and compiled')
  } catch (error) {
    logger.error('[CodeSnippetGenerator] Failed to compile code snippet templates', { error: String(error) })
  }

  return templates
}

// ============================================================================
// Code Snippet Generation
// ============================================================================

/**
 * Generate code snippets for a request.
 *
 * @param data - Full request data
 * @param envContext - Transformed environment context for Handlebars resolution
 * @param resolvedUrlResult - Pre-resolved URL result (from URLResolver)
 * @param templates - Compiled Handlebars snippet templates
 * @param transformValue - Function to resolve Handlebars templates
 * @returns The generated code snippets result
 */
export function generateCodeSnippets(
  data: FullRequestData,
  envContext: TransformedContext,
  resolvedUrlResult: ResolvedUrlResult | undefined,
  templates: CompiledSnippetTemplates,
  transformValue: TransformValueFn
): CodeSnippetsResult {
  let markdown = ''

  // Get resolved URL
  const resolvedUrl = resolvedUrlResult?.resolvedUrl ?? transformValue(data.url, envContext)

  // Parse URL components
  let host = ''
  let urlPath = '/'
  try {
    const urlObj = new URL(resolvedUrl.startsWith('http') ? resolvedUrl : `https://${resolvedUrl}`)
    host = urlObj.host
    urlPath = urlObj.pathname + urlObj.search
  } catch {
    host = resolvedUrl
  }

  // Resolve headers (skip disabled ones)
  const headers = data.headers
    .filter(h => h.key && h.enabled !== false)
    .map(h => ({
      key: transformValue(h.key, envContext),
      value: transformValue(h.value.toString(), envContext)
    }))

  switch (data.requestType) {
    case 'auth':
    case 'http': {
      const method = data.method ?? 'GET'
      let body: string | null = null

      // Resolve body
      if (data.body) {
        switch (data.body.type) {
          case 'text':
            body = transformValue(data.body.content, envContext)
            break
          case 'form-data':
          case 'x-www-form-urlencoded':
            body = data.body.fields
              .filter(f => f.key)
              .map(f => `${encodeURIComponent(f.key)}=${encodeURIComponent(transformValue(f.value, envContext))}`)
              .join('&')
            break
        }
      }

      if (templates.httpSnippetTemplate) {
        markdown = templates.httpSnippetTemplate({
          method,
          lowerMethod: method.toLowerCase(),
          url: resolvedUrl,
          host,
          path: urlPath,
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

      if (templates.graphqlSnippetTemplate) {
        markdown = templates.graphqlSnippetTemplate({
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
      const message = data.message ? transformValue(data.message, envContext) : ''

      if (templates.websocketSnippetTemplate) {
        markdown = templates.websocketSnippetTemplate({
          url: resolvedUrl,
          protocol: data.protocol ?? 'websocket',
          event: data.event ?? '',
          message: message || null
        })
      }
      break
    }

    case 'grpc': {
      const requestMessage = data.requestMessage ? transformValue(data.requestMessage, envContext) : '{}'
      const metadata = (data.metadata ?? [])
        .filter(m => m.key)
        .map(m => ({
          key: transformValue(m.key, envContext),
          value: transformValue(m.value, envContext)
        }))

      if (templates.grpcSnippetTemplate) {
        markdown = templates.grpcSnippetTemplate({
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
      const soapBody = data.soapBody ? transformValue(data.soapBody, envContext) : ''

      if (templates.soapSnippetTemplate) {
        markdown = templates.soapSnippetTemplate({
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

  return { markdown }
}
