import React from 'react'
import { Modal, Button } from 'electron-core-ui/renderer'
import { useTranslation } from 'react-i18next'

export interface DeleteConfirmationModalProps {
  isOpen: boolean
  itemName: string
  isFolder: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Modal for confirming deletion of items (folders or requests)
 */
export const DeleteConfirmationModal: React.FC<DeleteConfirmationModalProps> = ({
  isOpen,
  itemName,
  isFolder,
  onConfirm,
  onCancel
}) => {
  const { t } = useTranslation()

  return (
    <Modal
      title={t('sidebar.deleteConfirm.title')}
      isOpen={isOpen}
      onClose={onCancel}
      size="dialog"
    >
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <p style={{ margin: 0 }}>
          {isFolder
            ? t('sidebar.deleteConfirm.folderMessage', { name: itemName })
            : t('sidebar.deleteConfirm.itemMessage', { name: itemName })}
        </p>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button secondary onClick={onCancel}>
            {t('sidebar.deleteConfirm.cancel')}
          </Button>
          <Button onClick={onConfirm}>
            {t('sidebar.deleteConfirm.confirm')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export default DeleteConfirmationModal
