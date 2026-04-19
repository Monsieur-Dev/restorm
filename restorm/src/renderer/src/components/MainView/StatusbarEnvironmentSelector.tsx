import React, { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconView,
  StatusbarElement,
  getContrastColor
} from 'electron-core-ui/renderer'
import type { Environment } from '../../../../shared/types/collections'
import { useEnvironmentContext } from '../../contexts/useEnvironmentContext'

/** Default "orange" used as a fallback for envs without a configured
 * `color` — matches the in-tab Send button + the color swatch in
 * `EnvironmentFolderView`. Lets the statusbar cell and every popover
 * row always have *some* tint even before a user sets one. */
const DEFAULT_ENV_COLOR = '#c75000'

/** Parse a `#rgb` or `#rrggbb` hex string into r/g/b bytes. Returns
 * `null` if the input isn't a well-formed hex — callers then fall
 * back to the raw color as a `background-color`. */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = hex.replace('#', '')
  const full = normalized.length === 3
    ? normalized.split('').map((c) => c + c).join('')
    : normalized
  if (full.length !== 6) return null
  const r = Number.parseInt(full.slice(0, 2), 16)
  const g = Number.parseInt(full.slice(2, 4), 16)
  const b = Number.parseInt(full.slice(4, 6), 16)
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null
  return { r, g, b }
}

/** Build a left-to-right fade-out gradient from the env color —
 * alpha 1 at the row's left edge, alpha 0 at the right, so the tint
 * reads as a wash behind the icon + label rather than a hard chip. */
function envGradient(color: string): string {
  const rgb = hexToRgb(color)
  if (!rgb) return color
  return `linear-gradient(to right, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 1) 0%, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0) 100%)`
}

function findEnvironmentById(environments: Environment[], id: string): Environment | null {
  for (const env of environments) {
    if (env.id === id) return env
    if (env.subEnvironments) {
      const found = findEnvironmentById(env.subEnvironments, id)
      if (found) return found
    }
  }
  return null
}

interface FlatEnvRow {
  env: Environment
  depth: number
}

/** Flatten the env tree depth-first so the popover can render every
 * node as a single row (no collapse/expand needed). Indentation via
 * `depth * 16 px` on each row keeps hierarchy visible. */
function flattenEnvironments(environments: Environment[], depth = 0, out: FlatEnvRow[] = []): FlatEnvRow[] {
  for (const env of environments) {
    out.push({ env, depth })
    if (env.subEnvironments && env.subEnvironments.length > 0) {
      flattenEnvironments(env.subEnvironments, depth + 1, out)
    }
  }
  return out
}

interface EnvPopoverProps {
  rows: FlatEnvRow[]
  selectedEnvId: string | null
  onSelect: (envId: string) => void
}

/** Popover content rendered inside `StatusbarElement`'s tooltip slot.
 * Each row is tinted with the env's color (fallback orange) and
 * auto-contrasted, so the user eyeballs the active env from the
 * same colour chip visible in the statusbar cell. */
const EnvPopoverList: React.FC<EnvPopoverProps> = ({ rows, selectedEnvId, onSelect }) => {
  return (
    <div
      role="listbox"
      aria-label="environments"
      data-testid="statusbar-env-selector-listview"
      style={{
        minWidth: 220,
        maxHeight: 320,
        overflow: 'auto',
        padding: 4,
        display: 'flex',
        flexDirection: 'column',
        gap: 2
      }}
    >
      {rows.map(({ env, depth }) => {
        const bg = env.color ?? DEFAULT_ENV_COLOR
        const fg = getContrastColor(bg)
        const isSelected = env.id === selectedEnvId
        return (
          <button
            key={env.id}
            type="button"
            role="option"
            aria-selected={isSelected}
            data-testid={`statusbar-env-selector-item-${env.id}`}
            onClick={(): void => { onSelect(env.id) }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              // Indent the whole row (incl. background) via `margin-left`,
              // not `padding-left` — otherwise the tint extends all the
              // way to the popover edge and the hierarchy reads as a
              // shifted label inside a full-width stripe instead of a
              // narrower nested chip.
              marginLeft: depth * 16,
              padding: '4px 8px',
              border: 'none',
              borderRadius: 3,
              background: envGradient(bg),
              color: fg,
              cursor: 'pointer',
              textAlign: 'left',
              fontSize: 12,
              lineHeight: 1.3,
              // Use the theme's `--focusBorder` token for the selected
              // row's outline. It's the same accent VSCode paints
              // around focused list rows and input fields, so the
              // picker sits consistently with the rest of the UI
              // regardless of the env's colour.
              outline: isSelected ? '1px solid var(--focusBorder)' : 'none',
              outlineOffset: isSelected ? -2 : 0
            }}
          >
            {env.icon && (
              <span style={{ display: 'inline-flex', alignItems: 'center', width: 14, height: 14, flexShrink: 0 }}>
                <IconView icon={env.icon} size={14} />
              </span>
            )}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {env.name}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * Statusbar cell that reflects the currently-selected environment for
 * the active request and opens a click-triggered popover (via
 * `StatusbarElement`'s built-in tooltip system, `tooltipTrigger="click"`)
 * to switch envs. Must be wrapped in an `EnvironmentProvider` scoped
 * to the active request — `useEnvironmentContext` supplies the env
 * list + current selection + color.
 */
export const StatusbarEnvironmentSelector: React.FC = () => {
  const { t } = useTranslation()
  const { environments, selectedEnvId, setSelectedEnvId, envColor } = useEnvironmentContext()

  const selectedEnvironment = useMemo<Environment | null>(() => {
    if (!environments || !selectedEnvId) return null
    return findEnvironmentById(environments, selectedEnvId)
  }, [environments, selectedEnvId])

  const selectedName = selectedEnvironment?.name ?? t('requestTab.environmentSelector.noEnvironment')

  const flatRows = useMemo(() => (
    environments && environments.length > 0 ? flattenEnvironments(environments) : []
  ), [environments])

  const handleSelect = useCallback((envId: string): void => {
    setSelectedEnvId(envId)
  }, [setSelectedEnvId])

  if (!environments || environments.length === 0) return null

  const effectiveColor = envColor ?? DEFAULT_ENV_COLOR

  return (
    <StatusbarElement
      data-testid="statusbar-env-selector"
      className="right-aligned"
      {...(selectedEnvironment?.icon ? { icon: selectedEnvironment.icon } : {})}
      backgroundColor={effectiveColor}
      title={selectedName}
      tooltipTrigger="click"
      tooltipPlacement="above"
    >
      <EnvPopoverList rows={flatRows} selectedEnvId={selectedEnvId} onSelect={handleSelect} />
    </StatusbarElement>
  )
}

export default StatusbarEnvironmentSelector
