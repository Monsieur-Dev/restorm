import React from 'react'
import registryData from './badgeRegistry.json'
import './registryBadge.css'

/**
 * One entry of `badgeRegistry.json`. The registry is the single declarative
 * source for badge rendering: background color, glyph/text color, the default
 * codicon and label, and the server-capsule flag. Every surface (sidebar, add
 * menu, scenario palette, workbench tabs, scenario node headers) renders its
 * badges from this shape — no call site rebuilds a badge with literal colors or
 * per-protocol CSS.
 */
export interface BadgeRegistryEntry {
  /** CSS background value — a `var(--…)` theme-token reference (so every named
   * theme keeps its own palette). Omitted for the `pro` variant, whose gold
   * gradient is a fixed brand color supplied by CSS. */
  color?: string
  /** Default label; omitted for icon-only entries (auth / scenario). */
  text?: string
  /** Glyph + text color — a `var(--…)` theme-token reference. Only the badges
   * whose background is light (SOAP, MQTT) set this to a dark token; everything
   * else inherits the shared on-accent white from CSS. The codicon inherits
   * this color, so the "white glyph on a dark badge" rule is a property here,
   * not a per-protocol CSS patch. */
  foreground?: string
  /** Server variant: renders the two-tone capsule — a fixed-color "SRV"
   * segment glued to the left of the badge body (which keeps this entry's
   * color). The SRV segment color is the shared
   * `--badge-capsule-glyph-background` token. */
  isServer?: boolean
  /** Codicon glyph name (no `codicon-` prefix) rendered before the text — or
   * instead of it for the icon-only entries (auth / scenario). */
  icon?: string
}

const registry: Record<string, BadgeRegistryEntry> = registryData

export interface RegistryBadgeProps {
  /** Registry entry id, e.g. `http_get`. Unknown ids fall back to `http_other`. */
  badgeId: string
  /** Custom label overriding the registry's default text. */
  text?: string | undefined
  /** Force the SRV capsule for entries whose body is caller-dependent — the
   * HTTP mock server keeps its METHOD color (`http_get` + server), so its
   * server-ness can't live on the registry entry. Fixed-protocol servers
   * declare `isServer` on their entry instead. */
  server?: boolean | undefined
  className?: string | undefined
  'data-testid'?: string | undefined
}

/**
 * Declarative badge pill: rendering is fully driven by `badgeRegistry.json`.
 * Fixed height matches the scenario badge so mixed badge rows align, and the
 * corner radius matches every other badge pill. Wrap in `BeamWrap` for the
 * activity contour beam — the beam overlay is geometry-agnostic.
 */
export const RegistryBadge: React.FC<RegistryBadgeProps> = ({
  badgeId,
  text,
  server,
  className,
  'data-testid': dataTestId
}) => {
  const spec = registry[badgeId] ?? registry['http_other']
  const label = text ?? spec?.text ?? ''
  const isCapsule = server === true || spec?.isServer === true
  // Server capsules never carry a glyph (parity with the legacy badge): the
  // "SRV" segment is the only decoration. Client badges render the entry's
  // codicon before the label.
  const showIcon = spec?.icon !== undefined && !isCapsule

  const bodyStyle: React.CSSProperties = {}
  if (spec?.color !== undefined) bodyStyle.backgroundColor = spec.color
  if (spec?.foreground !== undefined) bodyStyle.color = spec.foreground

  const body = (
    <span
      className={`registry-badge${className && !isCapsule ? ` ${className}` : ''}${isCapsule ? ' registry-badge--capsule-body' : ''}`}
      style={bodyStyle}
      data-badge-id={badgeId}
      {...(dataTestId !== undefined && !isCapsule && { 'data-testid': dataTestId })}
    >
      {showIcon && (
        <i
          className={`codicon codicon-${spec.icon}`}
          aria-hidden="true"
          {...(label !== '' && { style: { marginRight: 3 } })}
        />
      )}
      {label}
    </span>
  )
  if (!isCapsule) return body
  return (
    <span
      className={`badge-capsule${className ? ` ${className}` : ''}`}
      aria-label={`${label} server`}
      data-badge-id={badgeId}
      data-badge-server="true"
      {...(dataTestId !== undefined && { 'data-testid': dataTestId })}
    >
      <span className="badge-capsule-glyph">SRV</span>
      {body}
    </span>
  )
}
