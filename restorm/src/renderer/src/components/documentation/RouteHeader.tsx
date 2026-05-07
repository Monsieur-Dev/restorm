import React from 'react'
import { MarkdownViewer } from 'electron-core-ui/renderer'
import type { OperationDocumentation } from '../../../../shared/types/apiDocumentation'
import { Badge } from '../common/Badge'
import { mapToBadgeType } from '../../utils/badgeUtils'

export interface RouteHeaderProps {
  /** The operation surfaced. */
  operation: OperationDocumentation
  /** Title heading level — H1 for single-route scope, H2 when this
   * RouteHeader sits inside a multi-route document (env folder /
   * folder docs) so the outer scope title stays the only H1. */
  headingLevel?: 1 | 2
  /** Show the operation's `group` (tag) as a chip next to the
   * method/URL line. Useful in multi-route docs where several
   * tags are interleaved; redundant in single-route since the
   * folder hierarchy already conveys the tag. */
  showGroupChip?: boolean
  /** Optional callback wiring an "Add" button below the title. Only
   * rendered when defined — single-route docs typically don't need
   * it because the user is already viewing a request, while multi-
   * route docs surface the button so a reader can spawn a fresh
   * pre-configured request from any route shown. */
  onAddRequest?: (operation: OperationDocumentation) => void
}

function formatBodyParameter(operation: OperationDocumentation): string | undefined {
  const body = operation.parameters?.find((p) => p.location === 'body')
  if (!body) return undefined
  return body.type
}

function formatRequestPayload(operation: OperationDocumentation): unknown {
  const body = operation.parameters?.find((p) => p.location === 'body')
  if (!body) return undefined
  if (body.example !== undefined) return body.example
  if (body.examples !== undefined) {
    if (Array.isArray(body.examples)) return body.examples[0]
    const values = Object.values(body.examples)
    return values.length > 0 ? values[0] : undefined
  }
  return undefined
}

function formatResponseSchema(operation: OperationDocumentation): string | undefined {
  if (!operation.responses) return undefined
  const candidates = ['200', '201', '2XX', 'default']
  for (const code of candidates) {
    const resp = operation.responses[code]
    if (resp?.schema) return resp.schema
  }
  for (const resp of Object.values(operation.responses)) {
    if (resp.schema) return resp.schema
  }
  return undefined
}

function stringifyPayload(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function payloadLanguage(value: unknown): string {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.startsWith('<')) return 'xml'
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json'
    return 'plaintext'
  }
  return 'json'
}

/**
 * Surface non-HTTP discriminants from `OperationMatchCriteria` as
 * label/value pairs. HTTP-only specs (Swagger / OpenAPI) won't
 * yield any; SOAP, gRPC, GraphQL, AsyncAPI / WebSocket imports
 * carry the protocol-specific identifiers here.
 */
function describeNonHttpDiscriminators(operation: OperationDocumentation): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = []
  const m = operation.match
  if (m.method === undefined) {
    if (m.operationType !== undefined && m.operationType.length > 0) {
      out.push({ label: 'op', value: m.operationType })
    }
  }
  if (m.serviceName !== undefined && m.serviceName.length > 0) {
    out.push({ label: 'service', value: m.serviceName })
  }
  if (m.operationName !== undefined && m.operationName.length > 0) {
    out.push({ label: 'name', value: m.operationName })
  }
  if (m.soapAction !== undefined && m.soapAction.length > 0) {
    out.push({ label: 'soapAction', value: m.soapAction })
  }
  if (m.event !== undefined && m.event.length > 0) {
    out.push({ label: 'event', value: m.event })
  }
  if (m.direction !== undefined) {
    out.push({ label: 'direction', value: m.direction })
  }
  return out
}

/**
 * Header card for a single operation: surfaces the human-readable
 * title (summary), description, request/response body shapes, and
 * an example payload inferred from the body parameter. This is the
 * "first thing the reader looks at" surface for a route, so the
 * data is laid out vertically with clear labels rather than a
 * dense table.
 */
export const RouteHeader: React.FC<RouteHeaderProps> = ({ operation, headingLevel = 1, showGroupChip = false, onAddRequest }) => {
  const requestBodyType = formatBodyParameter(operation)
  const responseSchema = formatResponseSchema(operation)
  const requestPayload = formatRequestPayload(operation)
  const consumes = operation.consumes?.join(', ')
  const produces = operation.produces?.join(', ')
  const SummaryHeading = headingLevel === 2 ? 'h2' : 'h1'
  const verb = operation.match.method ?? operation.match.operationType
  const altDiscriminators = describeNonHttpDiscriminators(operation)

  return (
    <div
      className="documentation-host-route-header"
      data-testid="documentation-host-route-header"
    >
      {operation.summary !== undefined && operation.summary.length > 0 && (
        <SummaryHeading className="documentation-host-route-header__summary">
          {operation.summary}
          {operation.deprecated === true && (
            <span className="documentation-host-route-header__badge documentation-host-route-header__badge--deprecated">
              deprecated
            </span>
          )}
        </SummaryHeading>
      )}

      <div className="documentation-host-route-header__match">
        {verb !== undefined && verb.length > 0 && (
          <Badge type={mapToBadgeType(verb)} />
        )}
        <code className="documentation-host-route-header__url">{operation.match.urlPattern}</code>
        {showGroupChip && operation.group !== undefined && operation.group.length > 0 && (
          <span
            className="documentation-host-route-header__group-chip"
            data-testid="documentation-host-route-header-group-chip"
          >
            {operation.group}
          </span>
        )}
        {altDiscriminators.length > 0 && (
          <span className="documentation-host-route-header__alt-discriminators">
            {altDiscriminators.map(({ label, value }) => (
              <span key={label} className="documentation-host-route-header__alt-discriminator">
                <span className="documentation-host-route-header__alt-label">{label}:</span>
                {' '}
                <code>{value}</code>
              </span>
            ))}
          </span>
        )}
      </div>

      {onAddRequest !== undefined && (
        <button
          type="button"
          className="documentation-host-route-header__add-button"
          data-testid={`documentation-host-route-header-add-${operation.operationId ?? operation.match.urlPattern}`}
          onClick={(): void => { onAddRequest(operation) }}
        >
          + Add a request
        </button>
      )}

      {operation.description !== undefined && operation.description.length > 0 && (
        <div className="documentation-host-route-header__description">
          <MarkdownViewer
            value={operation.description}
            data-testid="documentation-host-route-header-description"
          />
        </div>
      )}

      <dl className="documentation-host-route-header__meta">
        {operation.operationId !== undefined && operation.operationId.length > 0 && (
          <>
            <dt>operationId</dt>
            <dd><code>{operation.operationId}</code></dd>
          </>
        )}
        {requestBodyType !== undefined && (
          <>
            <dt>Request body</dt>
            <dd>
              <code>{requestBodyType}</code>
              {consumes !== undefined && consumes.length > 0 && (
                <span className="documentation-host-route-header__meta-extra"> ({consumes})</span>
              )}
            </dd>
          </>
        )}
        {responseSchema !== undefined && (
          <>
            <dt>Response body</dt>
            <dd>
              <code>{responseSchema}</code>
              {produces !== undefined && produces.length > 0 && (
                <span className="documentation-host-route-header__meta-extra"> ({produces})</span>
              )}
            </dd>
          </>
        )}
        {operation.security !== undefined && operation.security.length > 0 && (
          <>
            <dt>Security</dt>
            <dd>
              <ul className="documentation-host-route-header__security-list">
                {operation.security.map((requirement, idx) => {
                  const entries = Object.entries(requirement)
                  return (
                    <li key={idx} className="documentation-host-route-header__security-item">
                      {entries.length === 0 ? (
                        <em>open (no auth)</em>
                      ) : (
                        entries.map(([scheme, scopes]) => (
                          <span key={scheme} className="documentation-host-route-header__security-scheme">
                            <code>{scheme}</code>
                            {scopes.length > 0 && (
                              <span className="documentation-host-route-header__security-scopes">
                                {' '}({scopes.join(', ')})
                              </span>
                            )}
                          </span>
                        ))
                      )}
                    </li>
                  )
                })}
              </ul>
            </dd>
          </>
        )}
        {operation.externalDocs !== undefined && (
          <>
            <dt>External docs</dt>
            <dd>
              <a href={operation.externalDocs.url}>
                {operation.externalDocs.description !== undefined && operation.externalDocs.description.length > 0
                  ? operation.externalDocs.description
                  : operation.externalDocs.url}
              </a>
            </dd>
          </>
        )}
      </dl>

      {requestPayload !== undefined && (
        <details
          className="documentation-host-route-header__payload"
          data-testid="documentation-host-route-header-payload"
          open
        >
          <summary>Example payload</summary>
          <pre
            className="documentation-host-route-header__payload-pre"
            data-language={payloadLanguage(requestPayload)}
          >
            {stringifyPayload(requestPayload)}
          </pre>
        </details>
      )}
    </div>
  )
}
