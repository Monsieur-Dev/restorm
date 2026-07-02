import React from 'react'
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
              const fieldDiff = computeEntityFieldDiff(conflict.kind, conflict.ours, conflict.theirs)
              return <ConflictEntityPanel entity={conflict.ours} mode="readOnly" {...(fieldDiff ? { fieldDiff } : {})} />
            }}
            renderServerPanel={(id) => {
              const conflict = conflicts.find((c) => c.id === id)
              if (!conflict) return null
              const fieldDiff = computeEntityFieldDiff(conflict.kind, conflict.ours, conflict.theirs)
              return <ConflictEntityPanel entity={conflict.theirs} mode="readOnly" {...(fieldDiff ? { fieldDiff } : {})} />
            }}
            renderResolvedPanel={(id) => {
              const conflict = conflicts.find((c) => c.id === id)
              const fieldDiff = conflict ? computeEntityFieldDiff(conflict.kind, conflict.ours, conflict.theirs) : undefined
              return (
                <ConflictEntityPanel
                  entity={getResolvedEntity(id)}
                  mode="editable"
                  {...(fieldDiff ? { fieldDiff } : {})}
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
