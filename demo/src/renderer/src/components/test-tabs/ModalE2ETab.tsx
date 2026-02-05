import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Modal } from 'electron-core-ui/renderer'

type CloseReason = 'escape' | 'button' | 'middle' | 'external' | ''
type ModalSize = 'full' | 'dialog'

interface ModalCloseRequestDetail {
  testId?: unknown
  reason?: unknown
}

function asCloseReason(value: unknown): CloseReason {
  if (value === 'escape' || value === 'button' || value === 'middle' || value === 'external' || value === '') {
    return value
  }
  return ''
}

const ModalE2ETab: React.FC = () => {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState<boolean>(false)
  const [size, setSize] = useState<ModalSize>('full')
  const [lastClose, setLastClose] = useState<CloseReason>('')

  useEffect(() => {
    const handler = (event: Event): void => {
      const anyEvent = event as unknown as { detail?: ModalCloseRequestDetail }
      const detail = anyEvent.detail
      if (!detail) return
      if (detail.testId !== 'modal-e2e') return
      setLastClose(asCloseReason(detail.reason))
    }
    window.addEventListener('ecu-modal-close-request', handler)
    return () => { window.removeEventListener('ecu-modal-close-request', handler) }
  }, [])

  const openFull = useCallback((): void => {
    setSize('full')
    setIsOpen(true)
  }, [])

  const openDialog = useCallback((): void => {
    setSize('dialog')
    setIsOpen(true)
  }, [])

  const closeExternal = useCallback((): void => {
    setLastClose('external')
    setIsOpen(false)
  }, [])

  const onClose = useCallback((): void => {
    setIsOpen(false)
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, gap: 8, padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Button data-testid="modal-open-full" secondary onClick={openFull}>
          {t('modal.harness.openFull')}
        </Button>
        <Button data-testid="modal-open-dialog" secondary onClick={openDialog}>
          {t('modal.harness.openDialog')}
        </Button>
        <Button data-testid="modal-close-external" secondary disabled={!isOpen} onClick={closeExternal}>
          {t('modal.harness.closeExternal')}
        </Button>
      </div>

      <div>
        {t('modal.harness.instructions')}
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <div data-testid="modal-ready">true</div>
        <div data-testid="modal-last-close">{lastClose}</div>
      </div>

      <Modal
        data-testid="modal-e2e"
        title={t('modal.harness.title')}
        isOpen={isOpen}
        size={size}
        onClose={onClose}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>{t('modal.harness.bodyText')}</div>
        </div>
      </Modal>
    </div>
  )
}

export default ModalE2ETab
