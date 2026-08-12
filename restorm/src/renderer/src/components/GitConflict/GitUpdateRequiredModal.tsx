import React from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, Button } from 'electron-core-ui/renderer'

export type GitUpdateChoice = 'keepMine' | 'keepServer' | 'resolve'

export interface GitUpdateRequiredModalProps {
  isOpen: boolean
  /** Names of the contested entities, exposed for assertions. */
  conflictNames?: string
  /** How many entities genuinely conflict. Always ≥ 1: with nothing
   * contested the caller updates silently and never opens this. */
  conflictCount: number
  onClose: () => void
  onChoice: (choice: GitUpdateChoice) => void
  'data-testid'?: string
}

/**
 * Shown when the user asks to publish (or update) while the server holds
 * a newer version AND the two versions genuinely disagree. It replaces
 * what used to happen here: a commit the user never asked for, followed
 * by git's raw English rejection in a toast.
 *
 * It deliberately does NOT appear for a plain "you are behind": when
 * nothing is contested there is no decision to make — the caller merges
 * and carries on. Asking anyway would be ceremony for its own sake, and
 * the whole point of computing conflicts up front is to know the
 * difference before bothering anyone.
 *
 * The three ways forward are the three ways a real disagreement can end,
 * plus backing out:
 *   - Cancel        → nothing happens at all, not even a commit
 *   - Keep mine     → my side wins the contested entities (their
 *                     uncontested work still merges in)
 *   - Keep server   → drop my local changes entirely and take the
 *                     server's version
 *   - Resolve       → decide entity by entity in the 4-panel view
 *
 * `conflictCount` comes from the same routine that feeds the resolution
 * view, so the number announced here and the entities listed there can
 * never disagree.
 */
export const GitUpdateRequiredModal: React.FC<GitUpdateRequiredModalProps> = ({
  isOpen,
  conflictCount,
  conflictNames = '',
  onClose,
  onChoice,
  'data-testid': dataTestId = 'git-update-required-modal'
}) => {
  const { t } = useTranslation()

  return (
    <Modal
      title={t('gitUpdate.title')}
      isOpen={isOpen}
      onClose={onClose}
      size="dialog"
      dialogWidth={640}
      data-testid={dataTestId}
      enterActionTestId={`${dataTestId}-resolve-button`}
    >
      {/* The contested entities, exposed for assertions: a count alone
        * cannot tell a correct verdict from a wrong one, and "which
        * entity" is exactly what a failing expectation needs to say. */}
      <span
        hidden
        data-testid={`${dataTestId}-conflict-names`}
      >{conflictNames}</span>
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <p style={{ margin: 0, lineHeight: 1.5 }} data-testid={`${dataTestId}-message`}>
          {t('gitUpdate.message')}
        </p>

        <p
          style={{ margin: 0, lineHeight: 1.5, fontWeight: 600 }}
          data-testid={`${dataTestId}-conflict-count`}
        >
          {t('gitUpdate.conflictCount', { count: conflictCount })}
        </p>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <Button secondary onClick={onClose} data-testid={`${dataTestId}-cancel-button`}>
            {t('gitUpdate.cancel')}
          </Button>
          <Button
            secondary
            onClick={() => { onChoice('keepMine') }}
            data-testid={`${dataTestId}-keep-mine-button`}
          >
            {/* Always the explicit wording: this modal only exists when
              * something IS contested, so keeping our side necessarily
              * discards the server's version of those entities. */}
            {t('gitUpdate.keepMineOverwriting')}
          </Button>
          <Button
            secondary
            onClick={() => { onChoice('keepServer') }}
            data-testid={`${dataTestId}-keep-server-button`}
          >
            {t('gitUpdate.keepServerVersion')}
          </Button>
          <Button onClick={() => { onChoice('resolve') }} data-testid={`${dataTestId}-resolve-button`}>
            {t('gitUpdate.resolveConflicts')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
