/**
 * IncompatibleProjectModal — shown when an open was refused because the
 * project declares a file format this build predates.
 *
 * The refusal itself happens in the main process, before anything is read
 * into the app or written to disk. This component only reports it, and it
 * lives in the renderer for a concrete reason: the main process ships two
 * locales, the renderer ships them all, and a user running the app in
 * Japanese should not be told in English why their file would not open.
 */

import React, { useCallback, useEffect, useState } from 'react'
import { Modal, Button } from 'electron-core-ui/renderer'
import { useTranslation } from 'react-i18next'
import { FILE_FORMAT_TOO_NEW_CODE, FILE_FORMAT_MISSING_CODE } from '../../../../shared/config/fileFormatVersion'
import './IncompatibleProjectModal.css'

interface RejectionState {
  path: string
  /** Which refusal to word the dialog as. */
  code: typeof FILE_FORMAT_TOO_NEW_CODE | typeof FILE_FORMAT_MISSING_CODE
  found?: number
  current?: number
}

export function IncompatibleProjectModal(): React.JSX.Element | null {
  const { t } = useTranslation()
  const [rejection, setRejection] = useState<RejectionState | null>(null)

  useEffect(() => {
    // Reached through a local cast rather than the ambient `window.api`
    // type: restorm augments that global, and the augmentation shadows
    // the library's own declaration for members added on the ECUI side.
    const w = window as unknown as {
      api?: {
        file?: {
          onFileOpenRejected?: (
            callback: (payload: { path: string; code?: string; detail?: Record<string, unknown> }) => void
          ) => () => void
        }
      }
    }
    const off = w.api?.file?.onFileOpenRejected?.((payload) => {
      // Only this build's format-version refusal is rendered here. Other
      // codes belong to whatever surface owns them; swallowing them into a
      // "too new" message would misreport the cause.
      if (payload.code !== FILE_FORMAT_TOO_NEW_CODE && payload.code !== FILE_FORMAT_MISSING_CODE) return
      const detail = payload.detail ?? {}
      const next: RejectionState = { path: payload.path, code: payload.code }
      if (typeof detail['found'] === 'number') next.found = detail['found']
      if (typeof detail['current'] === 'number') next.current = detail['current']
      setRejection(next)
    })
    return off
  }, [])

  const handleClose = useCallback(() => {
    setRejection(null)
  }, [])

  if (!rejection) return null

  return (
    <Modal
      isOpen
      onClose={handleClose}
      size="dialog"
      title={rejection.code === FILE_FORMAT_MISSING_CODE ? t('project.notARestormFile.title') : t('project.incompatible.title')}
      data-testid="incompatible-project-modal"
      enterActionTestId="incompatible-project-dismiss"
    >
      <div className="incompatible-project" data-testid="incompatible-project-body">
        <p className="incompatible-project__message">
          {rejection.code === FILE_FORMAT_MISSING_CODE
            ? t('project.notARestormFile.message')
            : t('project.incompatible.message')}
        </p>
        <p className="incompatible-project__path" data-testid="incompatible-project-path">
          {rejection.path}
        </p>
        {rejection.found !== undefined && rejection.current !== undefined && (
          <p className="incompatible-project__versions">
            {t('project.incompatible.versions', {
              found: rejection.found,
              current: rejection.current
            })}
          </p>
        )}
        <div className="incompatible-project__actions">
          <Button onClick={handleClose} data-testid="incompatible-project-dismiss">
            {t('common.ok', 'OK')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export default IncompatibleProjectModal
