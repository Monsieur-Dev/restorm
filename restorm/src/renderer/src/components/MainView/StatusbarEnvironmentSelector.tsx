import React, { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  StatusbarElement,
  getContrastColor
} from 'electron-core-ui/renderer'
import type { Environment } from '../../../../shared/types/collections'
import { useEnvironmentContext } from '../../contexts/useEnvironmentContext'
import {
  clearSessionRequestOverridesForRequests,
  clearStoredRequestOverridesForRequests,
  findEnvironmentById
} from '../../services/environmentSelectionStore'

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
      {/* Each row is an ECUI Button stretched full-width via the
          `fullWidth` prop, with the env's tinted gradient applied
          directly to the button surface via `backgroundColor` so the
          color belongs to the button (not a wrapper halo). The
          `<div role="option">` wrapper only carries the listbox a11y
          pattern — Button doesn't propagate arbitrary `role` attrs. */}
      {rows.map(({ env, depth }) => {
        const bg = env.color ?? DEFAULT_ENV_COLOR
        const fg = getContrastColor(bg)
        const isSelected = env.id === selectedEnvId
        return (
          <div
            key={env.id}
            role="option"
            aria-selected={isSelected}
            data-testid={`statusbar-env-selector-item-${env.id}`}
            style={{ marginLeft: depth * 16 }}
          >
            <Button
              fullWidth
              secondary
              small
              line
              align="left"
              backgroundColor={envGradient(bg)}
              {...(env.icon ? { icon: env.icon } : {})}
              onClick={(): void => { onSelect(env.id) }}
              style={{
                color: fg,
                // The `small line` variants set `padding: 0` so the text
                // would butt up against the button's left edge — pad
                // 8px in by hand for a comfortable read.
                paddingLeft: 8,
                paddingRight: 8,
                outline: isSelected ? '1px solid var(--focusBorder)' : 'none',
                outlineOffset: isSelected ? -2 : 0
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {env.name}
              </span>
            </Button>
          </div>
        )
      })}
      {/* "Apply to all" toggle — OYO-196. Checked by default: writes
          the env as the *folder default* so every request in that env
          folder adopts it. Unchecked writes a per-request override
          (legacy flow) — the folder default is untouched. */}
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
   * All request ids under the same env folder as the active request
   * (incl. the active one). Passed in so that when the user picks
   * an env with "Apply to all" checked, we can wipe every sibling's
   * stale per-request override in one pass — the folder default is
   * now the source of truth for those requests.
   */
  folderRequestIds: string[]
  /** Project UUID of the currently-open file — used to scope the
   * override cleanup above. Optional because the store itself
   * no-ops when it's missing (in-memory-only mode). */
  projectUuid?: string | null
  /** When true (default), the StatusbarElement carries the
   * `right-aligned` class. App.tsx flips this off when an upstream
   * status-bar entry (e.g. the auth selector) already takes that
   * role — only the leftmost-of-the-right group needs the auto
   * margin, the rest follow naturally. */
  rightAligned?: boolean
}

/**
 * Statusbar cell that reflects the currently-selected environment for
 * the active request and opens a click-triggered popover (via
 * `StatusbarElement`'s built-in tooltip system, `tooltipTrigger="click"`)
 * to switch envs. Must be wrapped in an `EnvironmentProvider` scoped
 * to the active request — `useEnvironmentContext` supplies the env
 * list + current selection + color + setters.
 */
export const StatusbarEnvironmentSelector: React.FC<StatusbarEnvironmentSelectorProps> = ({
  folderRequestIds,
  projectUuid,
  rightAligned = true
}) => {
  const { t } = useTranslation()
  const {
    environments,
    selectedEnvId,
    envColor,
    setFolderEnv,
    setRequestOverride
  } = useEnvironmentContext()
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
    if (applyToAll) {
      // Wipe every sibling's *session* override synchronously BEFORE
      // `setFolderEnv` fires `ENV_FOLDER_ENV_CHANGED`. Otherwise a
      // sibling provider re-resolving on that event would still read
      // its stale override from the session cache and ignore the
      // fresh folder default. The disk cleanup can fall through to
      // its own async path since it only matters on next mount.
      if (projectUuid && folderRequestIds.length > 0) {
        clearSessionRequestOverridesForRequests(projectUuid, folderRequestIds)
      }
      setFolderEnv(envId)
      if (projectUuid && folderRequestIds.length > 0) {
        void clearStoredRequestOverridesForRequests(projectUuid, folderRequestIds)
      }
    } else {
      setRequestOverride(envId)
    }
  }, [applyToAll, projectUuid, folderRequestIds, setFolderEnv, setRequestOverride])

  if (!environments || environments.length === 0) return null

  const effectiveColor = envColor ?? DEFAULT_ENV_COLOR

  return (
    <StatusbarElement
      data-testid="statusbar-env-selector"
      className={rightAligned ? 'right-aligned' : ''}
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
