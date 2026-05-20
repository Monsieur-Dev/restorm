import React from 'react'
import './Badge.css'

/**
 * Badge types supported by the application
 */
export type BadgeType =
  // HTTP Methods
  | 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS'
  // gRPC call types
  | 'UNARY' | 'S-STR' | 'C-STR' | 'BIDI'
  // GraphQL
  | 'GQL' | 'QUERY' | 'MUTATION' | 'SUBSCRIPTION'
  // SOAP
  | 'SOAP'
  // WebSocket protocols
  | 'WS' | 'MQTT' | 'SIO'
  // OData
  | 'ODATA'
  // Authentication
  | 'AUTH'
  // Scenario (dataflow graph) — renders a circuit-board codicon
  | 'SCENARIO'
  // Marketing tier — shown next to import-format names that require a
  // paid plan. Distinct gold gradient so it doesn't read as a
  // protocol badge.
  | 'PRO'

export interface BadgeProps {
  /** The type of badge - determines styling */
  type: BadgeType
  /** Optional custom label - if not provided, uses the type as label */
  label?: string | undefined
  /** Optional additional CSS class */
  className?: string | undefined
}

/**
 * A unified badge component for displaying protocol/method indicators
 */
export const Badge: React.FC<BadgeProps> = ({ type, label, className }) => {
  const typeClass = `badge-${type.toLowerCase().replace('-', '')}`

  // Auth badges display an icon instead of text: the codicon-key
  // glyph is more recognisable than a three-letter acronym.
  if (type === 'AUTH') {
    return (
      <span className={`badge ${typeClass} ${className ?? ''}`} aria-label={label ?? 'Authentication request'}>
        <i className="codicon codicon-key" aria-hidden="true" />
      </span>
    )
  }

  // Scenarios show a circuit-board glyph (a dataflow graph), not text.
  if (type === 'SCENARIO') {
    return (
      <span className={`badge ${typeClass} ${className ?? ''}`} aria-label={label ?? 'Scenario'}>
        <i className="codicon codicon-circuit-board" aria-hidden="true" />
      </span>
    )
  }

  const displayText = label ?? type
  return (
    <span className={`badge ${typeClass} ${className ?? ''}`}>
      {displayText}
    </span>
  )
}

export default Badge
