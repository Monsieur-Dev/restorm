import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, Button, ConflictResolutionView } from 'electron-core-ui/renderer'
import type { UseConflictResolutionResult } from '../../hooks/useConflictResolution'
import { ConflictEntityPanel } from './ConflictEntityPanel'
import { ConflictQuickConfigBand } from './ConflictQuickConfigBand'
import { computeEntityFieldDiff, readQuickConfigs } from '../../services/conflictFieldDiff'
import type { FolderItem } from '../../../../shared/types/folderTypes'

/** Which side each conflicting quick-config currently resolves to: an explicit
 * per-config pick wins; otherwise it's derived from the resolved entity's
 * current config (which side its content matches), so a whole-entity pick is
 * reflected until the user overrides an individual config. */
function deriveCurrentSides(
  names: string[],
  resolved: FolderItem,
  theirs: FolderItem,
  picks: Record<string, 'ours' | 'theirs'> | undefined
): Record<string, 'ours' | 'theirs'> {
  const resolvedConfigs = readQuickConfigs(resolved)
  const theirsConfigs = readQuickConfigs(theirs)
  const sig = (configs: ReturnType<typeof readQuickConfigs>, name: string): string =>
    JSON.stringify(configs.find((c) => c.name === name)?.fields)
  const sides: Record<string, 'ours' | 'theirs'> = {}
  for (const name of names) {
    const explicit = picks?.[name]
    sides[name] = explicit ?? (sig(resolvedConfigs, name) === sig(theirsConfigs, name) ? 'theirs' : 'ours')
  }
  return sides
}

/** Column wrapper so the quick-config band sits above the entity panel and the
 * panel fills the remaining height. */
const panelWithBandStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', height: '100%' }
const panelBodyStyle: React.CSSProperties = { flex: 1, minHeight: 0 }

export interface GitConflictResolutionModalProps {
  isOpen: boolean
  conflictResolution: UseConflictResolutionResult
  onClose: () => void
  onFinish: () => void
}

/**
 * Mounts the generic `ConflictResolutionView` shell with restorm's
 * `ConflictEntityPanel` dispatcher wired into every render prop — the
 * concrete "4-panel conflict resolution UI" a pull conflict opens. Owns
 * no state of its own; everything comes from `useGitPullConflict` (via
 * its `conflictResolution` sub-result) through the parent.
 */
export const GitConflictResolutionModal: React.FC<GitConflictResolutionModalProps> = ({
  isOpen,
  conflictResolution,
  onClose,
  onFinish
}) => {
  const { t } = useTranslation()
  const { conflicts, selectedConflictId, selectConflict, getResolvedEntity, pickOursVersion, pickTheirsVersion, onScenarioChange, quickConfigPicks, pickQuickConfigVersion } = conflictResolution

  // ECUI's `ConflictResolutionView` always renders all three panels for the
  // SAME (selected) conflict, so the field-diff is identical across them.
  // Compute it once here (keyed on the selected conflict) instead of letting
  // each render prop recompute it — three passes of `computeEntityFieldDiff`
  // per render otherwise.
  const activeFieldDiff = useMemo(() => {
    const conflict = conflicts.find((c) => c.id === selectedConflictId)
    return conflict ? computeEntityFieldDiff(conflict.kind, conflict.ours, conflict.theirs) : undefined
  }, [conflicts, selectedConflictId])

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('git.conflictResolutionTitle')}
      data-testid="git-conflict-resolution-modal"
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '80vh' }}>
        <div style={{ flex: 1, minHeight: 0 }}>
          <ConflictResolutionView
            conflicts={conflicts.map((conflict) => ({ id: conflict.id, label: conflict.name }))}
            selectedConflictId={selectedConflictId}
            onSelectConflict={selectConflict}
            renderUserPanel={(id) => {
              const conflict = conflicts.find((c) => c.id === id)
              if (!conflict) return null
              const names = activeFieldDiff?.conflictingQuickConfigNames ?? []
              return (
                <div style={panelWithBandStyle}>
                  <ConflictQuickConfigBand mode="readOnly" conflictingNames={names} data-testid="conflict-quick-config-band-user" />
                  <div style={panelBodyStyle}>
                    <ConflictEntityPanel entity={conflict.ours} mode="readOnly" {...(activeFieldDiff ? { fieldDiff: activeFieldDiff } : {})} />
                  </div>
                </div>
              )
            }}
            renderServerPanel={(id) => {
              const conflict = conflicts.find((c) => c.id === id)
              if (!conflict) return null
              const names = activeFieldDiff?.conflictingQuickConfigNames ?? []
              return (
                <div style={panelWithBandStyle}>
                  <ConflictQuickConfigBand mode="readOnly" conflictingNames={names} data-testid="conflict-quick-config-band-server" />
                  <div style={panelBodyStyle}>
                    <ConflictEntityPanel entity={conflict.theirs} mode="readOnly" {...(activeFieldDiff ? { fieldDiff: activeFieldDiff } : {})} />
                  </div>
                </div>
              )
            }}
            renderResolvedPanel={(id) => {
              const conflict = conflicts.find((c) => c.id === id)
              const names = activeFieldDiff?.conflictingQuickConfigNames ?? []
              const resolved = getResolvedEntity(id)
              return (
                <div style={panelWithBandStyle}>
                  {conflict && (
                    <ConflictQuickConfigBand
                      mode="editable"
                      conflictingNames={names}
                      currentSides={deriveCurrentSides(names, resolved, conflict.theirs, quickConfigPicks[id])}
                      onPick={(name, side) => { pickQuickConfigVersion(id, name, side) }}
                      data-testid="conflict-quick-config-band-resolved"
                    />
                  )}
                  <div style={panelBodyStyle}>
                    <ConflictEntityPanel
                      entity={resolved}
                      mode="editable"
                      {...(activeFieldDiff ? { fieldDiff: activeFieldDiff } : {})}
                      onScenarioChange={(_scenarioId, patch) => { onScenarioChange(id, patch) }}
                    />
                  </div>
                </div>
              )
            }}
            {...(selectedConflictId ? { onUseUserVersion: () => { pickOursVersion(selectedConflictId) } } : {})}
            {...(selectedConflictId ? { onUseServerVersion: () => { pickTheirsVersion(selectedConflictId) } } : {})}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: 12 }}>
          <Button secondary onClick={onClose} data-testid="git-conflict-resolution-cancel">
            {t('git.conflictCancel')}
          </Button>
          <Button onClick={onFinish} disabled={conflicts.length === 0} data-testid="git-conflict-resolution-finish">
            {t('git.conflictFinish')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export default GitConflictResolutionModal
