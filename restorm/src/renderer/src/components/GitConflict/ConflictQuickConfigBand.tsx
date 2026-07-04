import React from 'react'
import { useTranslation } from 'react-i18next'
import { SelectBox, type ISelectData } from 'electron-core-ui/renderer'

export interface ConflictQuickConfigBandProps {
  mode: 'readOnly' | 'editable'
  /** Names of the same-named, divergent saved quick-configs
   * (`EntityFieldDiff.conflictingQuickConfigNames`). */
  conflictingNames: string[]
  /** `editable` mode only: the side each config currently resolves to (the
   * explicit per-config pick, or the whole-entity default) — drives the
   * SelectBox value. */
  currentSides?: Record<string, 'ours' | 'theirs'>
  /** `editable` mode only: pick a side for one individual config. */
  onPick?: (configName: string, side: 'ours' | 'theirs') => void
  'data-testid'?: string
}

/**
 * The per-quick-config conflict strip shown at the top of a request conflict
 * panel. Saved project quick-configs live outside the request's own editor
 * (they're an ad-hoc field, edited from the workbench header the conflict
 * modal doesn't mount), so a same-named config that differs on both sides has
 * no field in the tab view to red-flag. This strip surfaces those configs
 * explicitly: a red flag + the config name, and — on the editable resolved
 * panel — an ours/theirs picker per config, independent of the whole-entity
 * pick. The read-only user/server panels show the flag only (the mirror).
 */
export const ConflictQuickConfigBand: React.FC<ConflictQuickConfigBandProps> = ({
  mode,
  conflictingNames,
  currentSides,
  onPick,
  'data-testid': dataTestId
}) => {
  const { t } = useTranslation()
  if (conflictingNames.length === 0) return null
  return (
    <div
      className="conflict-quick-config-band"
      data-testid={dataTestId}
      style={{ padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--descriptionForeground)' }}>
        {t('git.quickConfigConflictTitle')}
      </div>
      {conflictingNames.map((name) => {
        const side = currentSides?.[name] ?? 'ours'
        return (
          <div
            key={name}
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
            data-testid={`conflict-quick-config-row-${name}`}
          >
            <span
              className="codicon codicon-flag"
              aria-hidden="true"
              style={{ color: 'var(--inputValidation-errorBorder)', flexShrink: 0 }}
            />
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {name}
            </span>
            {mode === 'editable' && onPick && (
              <div style={{ width: 120, flexShrink: 0 }}>
                <SelectBox
                  id={`conflict-quick-config-select-${name}`}
                  className=""
                  options={[
                    { text: 'ours', label: t('git.quickConfigOurs') },
                    { text: 'theirs', label: t('git.quickConfigTheirs') }
                  ]}
                  selected={side === 'theirs' ? 1 : 0}
                  onDidSelect={(d: ISelectData) => { onPick(name, d.index === 1 ? 'theirs' : 'ours') }}
                  data-testid={`conflict-quick-config-select-${name}`}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default ConflictQuickConfigBand
