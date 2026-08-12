import React from 'react'
import { Modal, Button } from 'electron-core-ui/renderer'
import { useTranslation } from 'react-i18next'
import { RegistryBadge } from '../common/RegistryBadge'

/** A scenario that references the request being deleted. */
export interface RequestScenarioDeleteUsage {
  scenarioId: string
  scenarioName: string
  /** The request lives inside this scenario's own subtree (authored as a child)
   * rather than being referenced from elsewhere. */
  inSubtree: boolean
}

export interface RequestScenarioDeleteModalProps {
  isOpen: boolean
  requestName: string
  usages: RequestScenarioDeleteUsage[]
  /** Move the request into the given scenario's subtree instead of deleting. */
  onMoveIntoScenario: (scenarioId: string) => void
  /** Delete the request and drop every referencing box from the scenarios. */
  onDeleteAnyway: () => void
  onCancel: () => void
}

/**
 * Deletion dialog shown when a request is referenced by one or more scenarios.
 * For a scenario the request is *external* to, it offers to move the request
 * into that scenario rather than break the link; for a scenario the request
 * *belongs* to, it warns that deleting affects the scenario. "Delete anyway"
 * removes the request and strips every box that referenced it (even if that
 * leaves a scenario incomplete).
 */
export const RequestScenarioDeleteModal: React.FC<RequestScenarioDeleteModalProps> = ({
  isOpen,
  requestName,
  usages,
  onMoveIntoScenario,
  onDeleteAnyway,
  onCancel
}) => {
  const { t } = useTranslation()
  const anyInSubtree = usages.some((u) => u.inSubtree)

  return (
    <Modal
      title={t('sidebar.scenarioDelete.title', 'Delete a request used by scenarios')}
      isOpen={isOpen}
      onClose={onCancel}
      size="dialog"
      data-testid="request-scenario-delete-modal"
      enterActionTestId="request-scenario-delete-confirm-button"
    >
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <p style={{ margin: 0 }}>
          {t('sidebar.scenarioDelete.message', '"{{name}}" is used in the following scenarios. What do you want to do?', { name: requestName })}
        </p>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {usages.map((u) => (
            <li key={u.scenarioId} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <RegistryBadge badgeId="scenario" />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {u.scenarioName}
                {u.inSubtree ? <span style={{ opacity: 0.6 }}> — {t('sidebar.scenarioDelete.belongsTag', 'belongs to this scenario')}</span> : null}
              </span>
              {!u.inSubtree ? (
                <span style={{ flexShrink: 0 }}>
                  <Button
                    secondary
                    onClick={() => { onMoveIntoScenario(u.scenarioId) }}
                    data-testid={`request-scenario-delete-move-${u.scenarioId}`}
                  >
                    {t('sidebar.scenarioDelete.moveInto', 'Move into this scenario')}
                  </Button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
        {anyInSubtree ? (
          <p style={{ margin: 0, opacity: 0.8 }}>
            {t('sidebar.scenarioDelete.affectsNote', 'Deleting this request will also remove it from these scenarios.')}
          </p>
        ) : null}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button secondary onClick={onCancel} data-testid="request-scenario-delete-cancel-button">
            {t('sidebar.deleteConfirm.cancel', 'Cancel')}
          </Button>
          <Button onClick={onDeleteAnyway} data-testid="request-scenario-delete-confirm-button">
            {t('sidebar.scenarioDelete.deleteAnyway', 'Delete anyway')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
