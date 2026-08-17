import React from 'react'
import { RegistryBadge } from './RegistryBadge'
import { resolveBadgeId, isKnownBadgeType } from '../../utils/badgeUtils'

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
  // JSON-RPC (single + batch)
  | 'RPC' | 'RPC[]'
  // Redis
  | 'REDIS'
  // Authentication
  | 'AUTH'
  // AMQP (RabbitMQ)
  | 'AMQP'
  // Scenario (dataflow graph) — renders a circuit-board codicon
  | 'SCENARIO'
  // API design — renders the symbol-color codicon
  | 'DESIGN'
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
  /** Optional codicon glyph name (without the `codicon-` prefix) — resolves to
   * the badge-registry action id for the protocol (e.g. WS + `arrow-up` →
   * `ws_send`). */
  icon?: string | undefined
  /** Client (default) vs server. `server` resolves to the protocol's SRV
   * capsule registry id (e.g. `ws_server`), or the method-colored capsule for
   * HTTP mock servers. */
  mode?: 'client' | 'server' | undefined
}

/**
 * Thin adapter over {@link RegistryBadge}: maps the legacy `type` / `mode` /
 * `icon` props onto a `badgeRegistry.json` id (via {@link resolveBadgeId}) and
 * renders the registry badge. It owns NO styling — the registry is the single
 * source. Prefer calling `RegistryBadge` with an explicit `badgeId` directly;
 * this adapter stays for the dynamic call sites that only know a runtime
 * protocol/method string.
 */
export const Badge: React.FC<BadgeProps> = ({ type, label, className, icon, mode }) => {
  const { badgeId, server } = resolveBadgeId(type, mode, icon)
  // Icon-only badges (auth, scenario) never show text. Otherwise a known type
  // takes its label from the registry; an unknown type (custom HTTP verb →
  // `http_other`) shows the raw verb verbatim.
  const iconOnly = type === 'AUTH' || type === 'SCENARIO' || type === 'DESIGN'
  const text = iconOnly ? undefined : label ?? (isKnownBadgeType(type) ? undefined : type)
  return (
    <RegistryBadge
      badgeId={badgeId}
      {...(text !== undefined && { text })}
      {...(server === true && { server: true })}
      {...(className !== undefined && { className })}
    />
  )
}
