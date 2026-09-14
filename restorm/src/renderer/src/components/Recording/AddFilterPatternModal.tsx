import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, InputBox, MessageType, Modal } from 'electron-core-ui/renderer'
import { isValidFilterPattern } from '../../../../shared/recording/captureFilters'

export type FilterListKind = 'whitelist' | 'blacklist'

export interface AddFilterPatternModalProps {
  open: boolean
  kind: FilterListKind
  /** The captured url the entry is prefilled with. */
  initialPattern: string
  onCancel: () => void
  /** `applyToExisting` = the destructive variant: the stored calls the lists
   * would now refuse are dropped. Confirmed inside the modal first. */
  onAdd: (pattern: string, applyToExisting: boolean) => void
}

/**
 * "Add to the white / black list" from a captured call's context menu: the
 * url prefilled as a pattern, "add", "add and apply to the captured calls"
 * (behind a confirmation — calls may disappear), cancel.
 */
export const AddFilterPatternModal: React.FC<AddFilterPatternModalProps> = ({ open, kind, initialPattern, onCancel, onAdd }) => {
  const { t } = useTranslation()
  // Initial state comes from the props; the parent remounts the modal (a
  // `key` per opening) so a new call starts from a fresh pattern.
  const [pattern, setPattern] = useState(initialPattern)
  const [confirming, setConfirming] = useState(false)
  const valid = pattern.trim() !== '' && isValidFilterPattern(pattern)
  const title = kind === 'whitelist' ? t('recording.captures.addToWhitelist') : t('recording.captures.addToBlacklist')

  return (
    <Modal title={title} isOpen={open} onClose={onCancel} size="dialog" data-testid="recording-filter-modal">
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {!confirming ? (
          <>
            <label className="design-field design-field-full">
              <span className="design-field-label">{t('recording.captures.patternLabel')}</span>
              <InputBox
                value={pattern}
                onChange={setPattern}
                changeDebounceMs={0}
                options={{
                  type: 'text',
                  ariaLabel: t('recording.captures.patternLabel'),
                  validationOptions: {
                    validation: (value: string) => (value.trim() === '' || isValidFilterPattern(value)
                      ? null
                      : { content: t('recording.config.invalidPattern'), type: MessageType.ERROR })
                  }
                }}
                data-testid="recording-filter-modal-pattern"
              />
            </label>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <Button secondary onClick={onCancel} data-testid="recording-filter-modal-cancel">{t('common.cancel')}</Button>
              <Button secondary disabled={!valid} onClick={() => { setConfirming(true) }} data-testid="recording-filter-modal-add-apply">
                {t('recording.captures.addAndApply')}
              </Button>
              <Button emphasis={1} disabled={!valid} onClick={() => { onAdd(pattern.trim(), false) }} data-testid="recording-filter-modal-add">
                {t('recording.captures.add')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p style={{ margin: 0 }} data-testid="recording-filter-modal-confirm-message">{t('recording.captures.applyConfirm')}</p>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <Button secondary onClick={() => { setConfirming(false) }} data-testid="recording-filter-modal-confirm-cancel">{t('common.cancel')}</Button>
              <Button emphasis={1} onClick={() => { onAdd(pattern.trim(), true) }} data-testid="recording-filter-modal-confirm-ok">
                {t('recording.captures.applyConfirmOk')}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
