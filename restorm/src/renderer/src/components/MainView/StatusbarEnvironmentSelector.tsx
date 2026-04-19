import React, { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconView,
  StatusbarElement,
  eventBus,
  getContrastColor
} from 'electron-core-ui/renderer'
import type { Environment } from '../../../../shared/types/collections'
import { useEnvironmentContext } from '../../contexts/useEnvironmentContext'
import { setSessionEnvSelection, setStoredEnvForRequest } from '../../services/environmentSelectionStore'
import { DocumentEvents, type RequestEnvEventPayload } from '../../services/DocumentEvents'

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
  applyToAll: boolean
  onApplyToAllChange: (next: boolean) => void
  onSelect: (envId: string) => void
}

/** Popover content rendered inside `StatusbarElement`'s tooltip slot.
 * Each row is tinted with the env's color (fallback orange) and
 * auto-contrasted, so the user eyeballs the active env from the
 * same colour chip visible in the statusbar cell. */
const EnvPopoverList: React.FC<EnvPopoverProps> = ({ rows, selectedEnvId, applyToAll, onApplyToAllChange, onSelect }) => {
  const { t } = useTranslation()
  return (
    <div
      role="listbox"
      aria-label="environments"
      data-testid="statusbar-env-selector-listview"
      style={{
        minWidth: 240,
        maxHeight: 360,
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
      {/* "Apply to all" toggle — per OYO-196 ticket. Checked by
          default: selecting an env propagates to every sibling
          request in the same env folder. Unchecked keeps the
          legacy per-request selection for users who need one. */}
      <label
        data-testid="statusbar-env-selector-apply-to-all"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginTop: 4,
          padding: '4px 8px',
          fontSize: 12,
          color: 'var(--foreground)',
          borderTop: '1px solid var(--dropdown-border)',
          cursor: 'pointer'
        }}
      >
        <input
          type="checkbox"
          checked={applyToAll}
          onChange={(e): void => { onApplyToAllChange(e.target.checked) }}
          data-testid="statusbar-env-selector-apply-to-all-input"
        />
        <span>{t('statusbar.envSelector.applyToAll', 'Apply to all requests')}</span>
      </label>
    </div>
  )
}

export interface StatusbarEnvironmentSelectorProps {
  /**
   * All request ids that live under the same env folder as the
   * active request (including the active one). When the user
   * selects an env with "Apply to all" checked, the selection
   * propagates to every id in this list.
   */
  folderRequestIds: string[]
  /** Current file path — needed to persist env picks for siblings
   * that aren't currently mounted. Passed directly rather than read
   * from a context because the component is tree-agnostic. */
  filePath?: string
}

/**
 * Statusbar cell that reflects the currently-selected environment for
 * the active request and opens a click-triggered popover (via
 * `StatusbarElement`'s built-in tooltip system, `tooltipTrigger="click"`)
 * to switch envs. Must be wrapped in an `EnvironmentProvider` scoped
 * to the active request — `useEnvironmentContext` supplies the env
 * list + current selection + color.
 */
export const StatusbarEnvironmentSelector: React.FC<StatusbarEnvironmentSelectorProps> = ({
  folderRequestIds,
  filePath
}) => {
  const { t } = useTranslation()
  const { environments, selectedEnvId, setSelectedEnvId, envColor } = useEnvironmentContext()
  const [applyToAll, setApplyToAll] = useState(true)

  const selectedEnvironment = useMemo<Environment | null>(() => {
    if (!environments || !selectedEnvId) return null
    return findEnvironmentById(environments, selectedEnvId)
  }, [environments, selectedEnvId])

  const selectedName = selectedEnvironment?.name ?? t('requestTab.environmentSelector.noEnvironment')

  const flatRows = useMemo(() => (
    environments && environments.length > 0 ? flattenEnvironments(environments) : []
  ), [environments])

  const handleSelect = useCallback((envId: string): void => {
    // Always update the active request via the provider — this also
    // emits `REQUEST_ENV_CHANGED` so sibling providers mounted for
    // the same request (the tab view) stay in lockstep.
    setSelectedEnvId(envId)

    if (!applyToAll || !filePath || folderRequestIds.length === 0) return

    // Propagate to every other request in the same env folder:
    //   1. Persist to session cache + disk so unmounted tabs pick up
    //      the new selection the next time they mount.
    //   2. Fire `REQUEST_ENV_SET` so any currently-mounted providers
    //      (e.g. the focused request's tab view) update their own
    //      state without waiting for a tab switch.
    for (const requestId of folderRequestIds) {
      if (requestId === selectedEnvId) continue // skip the provider already handled
      setSessionEnvSelection(filePath, requestId, envId)
      void setStoredEnvForRequest(filePath, requestId, envId)
      eventBus.emitLocalSync(DocumentEvents.REQUEST_ENV_SET, {
        requestId,
        envId
      } as RequestEnvEventPayload)
    }
  }, [applyToAll, filePath, folderRequestIds, selectedEnvId, setSelectedEnvId])

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
      <EnvPopoverList
        rows={flatRows}
        selectedEnvId={selectedEnvId}
        applyToAll={applyToAll}
        onApplyToAllChange={setApplyToAll}
        onSelect={handleSelect}
      />
    </StatusbarElement>
  )
}

export default StatusbarEnvironmentSelector
