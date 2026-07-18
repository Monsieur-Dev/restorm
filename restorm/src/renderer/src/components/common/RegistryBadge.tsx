import React from 'react'
import registryData from './badgeRegistry.json'
import './registryBadge.css'

/**
 * One entry of `badgeRegistry.json`. The registry is the single declarative
 * source for badge rendering: background color (a theme token reference, so
 * every named theme keeps its own palette) and the default text. Future
 * properties (server variant, codicon, …) extend this shape — never the
 * call sites.
 */
export interface BadgeRegistryEntry {
  /** CSS background value — a `var(--…)` theme-token reference. */
  color: string
  /** Default label; omitted for ids that only render caller-provided text. */
  text?: string
}

const registry: Record<string, BadgeRegistryEntry> = registryData

export interface RegistryBadgeProps {
  /** Registry entry id, e.g. `http_get`. Unknown ids fall back to `http_other`. */
  badgeId: string
  /** Custom label overriding the registry's default text. */
  text?: string | undefined
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
  className,
  'data-testid': dataTestId
}) => {
  const spec = registry[badgeId] ?? registry['http_other']
  const label = text ?? spec?.text ?? ''
  return (
    <span
      className={`registry-badge${className ? ` ${className}` : ''}`}
      style={{ backgroundColor: spec?.color }}
      data-badge-id={badgeId}
      {...(dataTestId !== undefined && { 'data-testid': dataTestId })}
    >
      {label}
    </span>
  )
}
