import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, Button, ConflictResolutionView } from 'electron-core-ui/renderer'
import type { UseConflictResolutionResult } from '../../hooks/useConflictResolution'
import { ConflictEntityPanel } from './ConflictEntityPanel'
import { computeEntityFieldDiff } from '../../services/conflictFieldDiff'

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
  const { conflicts, selectedConflictId, selectConflict, getResolvedEntity, pickOursVersion, pickTheirsVersion, onScenarioChange } = conflictResolution

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
              return <ConflictEntityPanel entity={conflict.ours} mode="readOnly" {...(activeFieldDiff ? { fieldDiff: activeFieldDiff } : {})} />
            }}
            renderServerPanel={(id) => {
              const conflict = conflicts.find((c) => c.id === id)
              if (!conflict) return null
              return <ConflictEntityPanel entity={conflict.theirs} mode="readOnly" {...(activeFieldDiff ? { fieldDiff: activeFieldDiff } : {})} />
            }}
            renderResolvedPanel={(id) => {
              return (
                <ConflictEntityPanel
                  entity={getResolvedEntity(id)}
                  mode="editable"
                  {...(activeFieldDiff ? { fieldDiff: activeFieldDiff } : {})}
                  onScenarioChange={(_scenarioId, patch) => { onScenarioChange(id, patch) }}
                />
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
