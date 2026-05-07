import React from 'react'
import type { OperationDocumentation } from '../../../../shared/types/apiDocumentation'

export interface OperationExtrasProps {
  operation: OperationDocumentation
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return ''
  }
}

/**
 * Catch-all surface for the operation's protocol-specific bag
 * (`extra`). Carries Postman auth, Bruno scripts, gRPC `callType`,
 * vendor extensions (`x-*`), and anything else the importer
 * stashed there. Hidden when the bag is empty so the rest of the
 * doc stays terse.
 */
export const OperationExtras: React.FC<OperationExtrasProps> = ({ operation }) => {
  const entries = operation.extra ? Object.entries(operation.extra) : []
  if (entries.length === 0) return null
  return (
    <details className="documentation-host-operation-extras" data-testid="documentation-host-operation-extras">
      <summary>Operation extras ({String(entries.length)})</summary>
      <table className="documentation-host-operation-extras__table">
        <tbody>
          {entries.map(([key, value]) => (
            <tr key={key}>
              <td className="documentation-host-operation-extras__key"><code>{key}</code></td>
              <td className="documentation-host-operation-extras__value">
                <pre>{stringifyValue(value)}</pre>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}
