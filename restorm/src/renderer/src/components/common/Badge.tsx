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
  // gRPC protocol (scenario action nodes)
  | 'GRPC'
  // GraphQL
  | 'GQL' | 'QUERY' | 'MUTATION' | 'SUBSCRIPTION'
  // SOAP
  | 'SOAP'
  // WebSocket protocols
  | 'WS' | 'MQTT' | 'SIO' | 'STOMP'
  // Server-Sent Events
  | 'SSE'
  // Kafka
  | 'KAFKA'
  // OData
  | 'ODATA'
  // tRPC
  | 'tRPC'
  // Redis
  | 'REDIS'
  // Authentication
  | 'AUTH'
  // AMQP (RabbitMQ)
  | 'AMQP'
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
  /** Optional codicon glyph name (without the `codicon-` prefix) rendered before
   * the text — e.g. a Socket.IO action badge shows the action's glyph + "SIO". */
  icon?: string | undefined
  /** Client (default) vs server. In `server` mode the badge becomes a two-part
   * "capsule": a dark "SRV" segment (left) glued to the protocol's normal
   * coloured badge (right) — a reusable norm for ANY hosted protocol
   * (SIO / WS / MQTT / gRPC / HTTP methods…), no per-protocol entry. */
  mode?: 'client' | 'server' | undefined
}

/**
 * A unified badge component for displaying protocol/method indicators
 */
export const Badge: React.FC<BadgeProps> = ({ type, label, className, icon, mode }) => {
  const typeClass = `badge-${type.toLowerCase().replace('-', '')}`

  // Server mode: a two-part capsule. The dark "SRV" segment (rounded on its
  // LEFT only) is glued to the protocol's normal coloured badge (rounded on its
  // RIGHT only) with no radius where they meet — like a two-tone pill. The
  // right segment keeps the protocol's own colour class, so POST stays blue,
  // SIO teal, etc. This is the shared norm for every hosted protocol.
  if (mode === 'server') {
    return (
      <span className={`badge-capsule ${className ?? ''}`} aria-label={label ?? `${type} server`}>
        <span className="badge-capsule-glyph">SRV</span>
        <span className={`badge ${typeClass} badge-capsule-body`}>{label ?? type}</span>
      </span>
    )
  }

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
      {icon !== undefined && <i className={`codicon codicon-${icon}`} aria-hidden="true" style={{ marginRight: 3 }} />}
      {displayText}
    </span>
  )
}

export default Badge
