import React, { useMemo, useState } from 'react'
import type {
  OperationDocumentation,
  ResponseDocumentation
} from '../../../../shared/types/apiDocumentation'
import { statusCodeColor } from './statusCodeColor'
import { extractModelRef, useDocumentedModels } from './documentationModels'
import { ModelRefLink } from './ModelRefLink'
import { DocViewerStatusCodeTooltip } from './StatusCodeTooltip'

export interface ResponsesTableProps {
  /** Operations to surface responses for. Each operation's
   * `responses` map contributes one row per status code. With a
   * single filtered operation the table is a flat list of its
   * status codes; with multiple operations the Operation column
   * disambiguates which route each row belongs to. */
  operations: OperationDocumentation[]
  /** Optional test id stamped on the root container. */
  testId?: string
}

interface ResponseRow {
  operationLabel: string
  operationId: string
  statusCode: string
  response: ResponseDocumentation
}

function rowKey(row: ResponseRow): string {
  return `${row.operationId}::${row.statusCode}`
}

function stringifyExample(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return ''
  }
}

function exampleLanguage(value: unknown): string {
  if (typeof value === 'string') {
    const t = value.trim()
    if (t.startsWith('<')) return 'xml'
    if (t.startsWith('{') || t.startsWith('[')) return 'json'
    return 'plaintext'
  }
  return 'json'
}

function hasDetails(resp: ResponseDocumentation): boolean {
  if (resp.schema !== undefined && resp.schema.length > 0) return true
  if (resp.headers && Object.keys(resp.headers).length > 0) return true
  if (resp.examples && Object.keys(resp.examples).length > 0) return true
  return false
}

/**
 * Flat table of every response declared by the surfaced operations,
 * one row per (operation, status code). The leftmost column carries
 * a coloured dot whose hue mirrors the runtime history palette
 * (`outcomeDotColor` in `ResponseHistoryTab`) — green for 2xx,
 * orange for 3xx, red for 4xx/5xx, neutral for `default` /
 * unrecognised codes. Rows with schema / headers / examples in the
 * source spec expand to a detail panel underneath.
 */
export const ResponsesTable: React.FC<ResponsesTableProps> = ({ operations, testId }) => {
  const rows = useMemo<ResponseRow[]>(() => {
    const out: ResponseRow[] = []
    operations.forEach((op, opIdx) => {
      const responses = op.responses
      if (!responses) return
      const operationLabel = `${op.match.method ?? op.match.operationType ?? ''} ${op.match.urlPattern}`.trim()
      const operationId = op.operationId ?? `op-${String(opIdx)}`
      for (const [statusCode, resp] of Object.entries(responses)) {
        out.push({ operationLabel, operationId, statusCode, response: resp })
      }
    })
    return out
  }, [operations])

  const showOperationColumn = operations.length > 1
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggle = (key: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (rows.length === 0) {
    return (
      <p
        className="documentation-host-responses-table__empty"
        data-testid={testId ?? 'documentation-host-responses-table-empty'}
      >
        No responses declared for the filtered routes.
      </p>
    )
  }

  return (
    <table
      className="documentation-host-responses-table"
      data-testid={testId ?? 'documentation-host-responses-table'}
    >
      <thead>
        <tr>
          <th className="documentation-host-responses-table__th documentation-host-responses-table__th--code">Status</th>
          {showOperationColumn && (
            <th className="documentation-host-responses-table__th">Operation</th>
          )}
          <th className="documentation-host-responses-table__th">Description</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => {
          const key = `${rowKey(row)}::${String(idx)}`
          const isExpanded = expanded.has(key)
          const expandable = hasDetails(row.response)
          return (
            <React.Fragment key={key}>
              <tr
                className={
                  'documentation-host-responses-table__row' +
                  (expandable ? ' documentation-host-responses-table__row--expandable' : '')
                }
                data-testid={`documentation-host-responses-row-${row.operationId}-${row.statusCode}`}
                onClick={expandable ? (): void => { toggle(key) } : undefined}
              >
                <td className="documentation-host-responses-table__td documentation-host-responses-table__td--code">
                  <span className="documentation-host-responses-table__caret">
                    {expandable ? (isExpanded ? '▾' : '▸') : ' '}
                  </span>
                  <span
                    className="documentation-host-responses-table__dot"
                    style={{ backgroundColor: statusCodeColor(row.statusCode) }}
                  />
                  <DocViewerStatusCodeTooltip code={row.statusCode}>
                    <span className="documentation-host-responses-table__code">{row.statusCode}</span>
                  </DocViewerStatusCodeTooltip>
                </td>
                {showOperationColumn && (
                  <td className="documentation-host-responses-table__td documentation-host-responses-table__td--op">
                    <code>{row.operationLabel}</code>
                  </td>
                )}
                <td className="documentation-host-responses-table__td">{row.response.description ?? ''}</td>
              </tr>
              {isExpanded && expandable && (
                <tr className="documentation-host-responses-table__detail-row">
                  <td
                    colSpan={showOperationColumn ? 3 : 2}
                    className="documentation-host-responses-table__detail-cell"
                  >
                    <ResponseDetail response={row.response} />
                  </td>
                </tr>
              )}
            </React.Fragment>
          )
        })}
      </tbody>
    </table>
  )
}

interface ResponseDetailProps {
  response: ResponseDocumentation
}

const ResponseDetail: React.FC<ResponseDetailProps> = ({ response }) => {
  const headers = response.headers ? Object.entries(response.headers) : []
  const examples = response.examples ? Object.entries(response.examples) : []
  const documentedModels = useDocumentedModels()
  const schemaRef = response.schema !== undefined ? extractModelRef(response.schema) : { ref: undefined, isArray: false }
  const linkable = schemaRef.ref !== undefined && documentedModels.has(schemaRef.ref)
  return (
    <div className="documentation-host-responses-detail">
      {response.schema !== undefined && response.schema.length > 0 && (
        <div className="documentation-host-responses-detail__row">
          <span className="documentation-host-responses-detail__label">Schema</span>
          {linkable && schemaRef.ref !== undefined ? (
            <code className="documentation-host-responses-detail__schema">
              <ModelRefLink modelName={schemaRef.ref}>{response.schema}</ModelRefLink>
            </code>
          ) : (
            <code className="documentation-host-responses-detail__schema">{response.schema}</code>
          )}
        </div>
      )}
      {headers.length > 0 && (
        <div className="documentation-host-responses-detail__row">
          <span className="documentation-host-responses-detail__label">Headers</span>
          <table className="documentation-host-responses-detail__headers">
            <tbody>
              {headers.map(([name, h]) => (
                <tr key={name}>
                  <td><code>{name}</code></td>
                  <td><code>{h.type}</code></td>
                  <td>{h.description ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {examples.map(([contentType, example]) => (
        <div key={contentType} className="documentation-host-responses-detail__row">
          <span className="documentation-host-responses-detail__label">Example ({contentType})</span>
          <pre
            className="documentation-host-responses-detail__example"
            data-language={exampleLanguage(example)}
          >
            {stringifyExample(example)}
          </pre>
        </div>
      ))}
    </div>
  )
}
