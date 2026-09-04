import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  OperationDocumentation,
  ParameterDocumentation,
  SchemaConstraints
} from '../../../../shared/types/apiDocumentation'
import { extractModelRef, useDocumentedEnums, useDocumentedModels } from './documentationModels'
import { ModelRefLink } from './ModelRefLink'

export interface ParametersTableProps {
  /** Operations to surface parameters for. With a single operation
   * the rows are just its parameters; with several, an extra
   * Operation column disambiguates. Body parameters are filtered
   * out — those are surfaced by `RouteHeader` as the request body
   * shape, repeating them in the parameter table is noise. */
  operations: OperationDocumentation[]
  /** Optional test id stamped on the root container. */
  testId?: string
}

interface ParamRow {
  operationLabel: string
  operationId: string
  parameter: ParameterDocumentation
}

function summariseConstraints(p: ParameterDocumentation): string | undefined {
  const c: SchemaConstraints | undefined = p.constraints
  const bits: string[] = []
  if (c) {
    if (c.minLength !== undefined || c.maxLength !== undefined) {
      bits.push(`length ${c.minLength ?? '?'}–${c.maxLength ?? '?'}`)
    }
    if (c.minimum !== undefined || c.maximum !== undefined) {
      bits.push(`${c.minimum ?? '−∞'} ≤ x ≤ ${c.maximum ?? '+∞'}`)
    }
    if (c.exclusiveMinimum !== undefined && c.exclusiveMinimum !== false) {
      bits.push(`> ${typeof c.exclusiveMinimum === 'number' ? String(c.exclusiveMinimum) : 'min'}`)
    }
    if (c.exclusiveMaximum !== undefined && c.exclusiveMaximum !== false) {
      bits.push(`< ${typeof c.exclusiveMaximum === 'number' ? String(c.exclusiveMaximum) : 'max'}`)
    }
    if (c.multipleOf !== undefined) bits.push(`× ${String(c.multipleOf)}`)
    if (c.pattern !== undefined) bits.push(`/${c.pattern}/`)
    if (c.uniqueItems === true) bits.push('unique')
  }
  if (p.collectionFormat !== undefined) bits.push(`array=${p.collectionFormat}`)
  if (p.allowEmptyValue === true) bits.push('allowEmpty')
  return bits.length > 0 ? bits.join(', ') : undefined
}

function formatExample(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return undefined
  }
}

function formatAdditionalExamples(p: ParameterDocumentation): { name: string; value: string }[] {
  if (!p.examples) return []
  const out: { name: string; value: string }[] = []
  if (Array.isArray(p.examples)) {
    p.examples.forEach((v, i) => {
      const formatted = formatExample(v)
      if (formatted !== undefined) out.push({ name: String(i), value: formatted })
    })
  } else {
    for (const [name, v] of Object.entries(p.examples)) {
      const formatted = formatExample(v)
      if (formatted !== undefined) out.push({ name, value: formatted })
    }
  }
  return out
}

/**
 * Flat table of every non-body parameter the surfaced operations
 * declare. One row per (operation, parameter); the leftmost column
 * carries a small location chip (path/query/header/formData/cookie)
 * coloured by location so the eye can group them at a glance.
 */
export const ParametersTable: React.FC<ParametersTableProps> = ({ operations, testId }) => {
  const { t } = useTranslation()
  const rows = useMemo<ParamRow[]>(() => {
    const out: ParamRow[] = []
    operations.forEach((op, opIdx) => {
      const operationLabel = `${op.match.method ?? op.match.operationType ?? ''} ${op.match.urlPattern}`.trim()
      const operationId = op.operationId ?? `op-${String(opIdx)}`
      for (const param of op.parameters ?? []) {
        if (param.location === 'body') continue
        out.push({ operationLabel, operationId, parameter: param })
      }
    })
    return out
  }, [operations])

  const showOperationColumn = operations.length > 1
  const documentedModels = useDocumentedModels()
  const documentedEnums = useDocumentedEnums()

  if (rows.length === 0) {
    return (
      <p
        className="documentation-host-parameters-table__empty"
        data-testid={testId ?? 'documentation-host-parameters-table-empty'}
      >
        {t('documentation.params.empty')}
      </p>
    )
  }

  return (
    <table
      className="documentation-host-parameters-table"
      data-testid={testId ?? 'documentation-host-parameters-table'}
    >
      <thead>
        <tr>
          <th className="documentation-host-parameters-table__th documentation-host-parameters-table__th--location">{t('documentation.table.in')}</th>
          <th className="documentation-host-parameters-table__th">{t('documentation.table.name')}</th>
          <th className="documentation-host-parameters-table__th">{t('documentation.table.type')}</th>
          <th className="documentation-host-parameters-table__th documentation-host-parameters-table__th--required">{t('documentation.table.required')}</th>
          {showOperationColumn && (
            <th className="documentation-host-parameters-table__th">{t('documentation.table.operation')}</th>
          )}
          <th className="documentation-host-parameters-table__th">{t('documentation.table.description')}</th>
          <th className="documentation-host-parameters-table__th">{t('documentation.table.example')}</th>
          <th className="documentation-host-parameters-table__th">{t('documentation.table.constraints')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => {
          const p = row.parameter
          const constraints = summariseConstraints(p)
          const example = formatExample(p.example)
          const enumValues = p.enumValues?.map((v) => String(v)).join(', ')
          const additionalExamples = formatAdditionalExamples(p)
          return (
            <tr
              key={`${row.operationId}::${p.location}::${p.name}::${String(idx)}`}
              className={
                'documentation-host-parameters-table__row' +
                (p.deprecated === true ? ' documentation-host-parameters-table__row--deprecated' : '')
              }
              data-testid={`documentation-host-parameters-row-${row.operationId}-${p.name}`}
            >
              <td className="documentation-host-parameters-table__td documentation-host-parameters-table__td--location">
                <span
                  className={`documentation-host-parameters-table__location-chip documentation-host-parameters-table__location-chip--${p.location}`}
                >
                  {p.location}
                </span>
              </td>
              <td className="documentation-host-parameters-table__td">
                <code>{p.name}</code>
              </td>
              <td className="documentation-host-parameters-table__td">
                {(() => {
                  const ref = extractModelRef(p.type)
                  if (ref.ref !== undefined && documentedEnums.has(ref.ref)) {
                    return (
                      <code>
                        <ModelRefLink modelName={ref.ref} kind="enum">{p.type}</ModelRefLink>
                      </code>
                    )
                  }
                  if (ref.ref !== undefined && documentedModels.has(ref.ref)) {
                    return (
                      <code>
                        <ModelRefLink modelName={ref.ref}>{p.type}</ModelRefLink>
                      </code>
                    )
                  }
                  return <code>{p.type}</code>
                })()}
                {p.format !== undefined && p.format.length > 0 && (
                  <span
                    className="documentation-host-parameters-table__format"
                    data-testid={`documentation-host-param-format-${p.name}`}
                  >
                    {p.format}
                  </span>
                )}
              </td>
              <td className="documentation-host-parameters-table__td documentation-host-parameters-table__td--required">
                {p.required ? '✓' : ''}
              </td>
              {showOperationColumn && (
                <td className="documentation-host-parameters-table__td">
                  <code className="documentation-host-parameters-table__op-label">{row.operationLabel}</code>
                </td>
              )}
              <td className="documentation-host-parameters-table__td">
                {p.description ?? ''}
                {enumValues !== undefined && (
                  <div className="documentation-host-parameters-table__enum">
                    enum: <code>{enumValues}</code>
                  </div>
                )}
                {p.defaultValue !== undefined && p.defaultValue.length > 0 && (
                  <div className="documentation-host-parameters-table__enum">
                    default: <code>{p.defaultValue}</code>
                  </div>
                )}
              </td>
              <td className="documentation-host-parameters-table__td">
                {example !== undefined && <code>{example}</code>}
                {additionalExamples.length > 0 && (
                  <ul className="documentation-host-parameters-table__additional-examples">
                    {additionalExamples.map((ex) => (
                      <li key={ex.name}>
                        <span className="documentation-host-parameters-table__example-name">{ex.name}:</span>
                        {' '}
                        <code>{ex.value}</code>
                      </li>
                    ))}
                  </ul>
                )}
              </td>
              <td className="documentation-host-parameters-table__td">
                {constraints !== undefined && (
                  <code className="documentation-host-parameters-table__constraints">{constraints}</code>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
