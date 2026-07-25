import React, { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toasterService, useStatusbarTooltip } from 'electron-core-ui/renderer'

interface StatusbarPathActionRow {
  id: string
  testId: string
  icon: string
  label: string
  run: () => void
}

interface StatusbarPathActionsListProps {
  filePath: string
  /** Dismisses the surrounding statusbar popover once an action fires. */
  onCloseRequested?: (() => void) | undefined
}

/**
 * The three actions offered on the statusbar file-path cell. Rendered as
 * the cell's popover content, so it follows the same shape as the env
 * selector's list: a `role="listbox"` of `role="option"` rows rather than
 * native buttons.
 */
export const StatusbarPathActionsList: React.FC<StatusbarPathActionsListProps> = ({
  filePath,
  onCloseRequested
}) => {
  const { t } = useTranslation()

  const rows = useMemo<StatusbarPathActionRow[]>(() => {
    const sep = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
    const fileName = filePath.slice(sep + 1)
    const copy = (text: string): void => {
      void navigator.clipboard.writeText(text).catch(() => { /* clipboard denied — no-op */ })
    }
    return [
      {
        id: 'reveal-in-folder',
        testId: 'statusbar-path-actions-reveal',
        icon: 'folder-opened',
        label: t('statusbar.contextMenu.revealInFolder'),
        run: () => {
          // The main process refuses anything that isn't the open project,
          // and the OS call can fail on its own (file moved or deleted since
          // it was opened). Either way the user gets told — a reveal that
          // silently does nothing reads as a broken entry.
          void window.restorm?.file.revealInFolder(filePath)
            .then((result) => {
              if (result.success) return
              toasterService.push('app', {
                title: t('statusbar.contextMenu.revealFailedTitle'),
                body: t('statusbar.contextMenu.revealFailedBody'),
                durationMs: 5000
              })
            })
            .catch(() => { /* channel unavailable — no-op */ })
        }
      },
      {
        id: 'copy-file-name',
        testId: 'statusbar-path-actions-copy-name',
        icon: 'copy',
        label: t('statusbar.contextMenu.copyFileName'),
        run: () => { copy(fileName) }
      },
      {
        id: 'copy-full-path',
        testId: 'statusbar-path-actions-copy-path',
        icon: 'copy',
        label: t('statusbar.contextMenu.copyFullPath'),
        run: () => { copy(filePath) }
      }
    ]
  }, [filePath, t])

  const handleActivate = useCallback((row: StatusbarPathActionRow): void => {
    row.run()
    onCloseRequested?.()
  }, [onCloseRequested])

  return (
    <div
      role="listbox"
      aria-label="file path actions"
      data-testid="statusbar-path-actions"
      style={{
        minWidth: 220,
        padding: 6,
        display: 'flex',
        flexDirection: 'column',
        gap: 1
      }}
    >
      {rows.map((row) => (
        <div
          key={row.id}
          role="option"
          aria-selected={false}
          tabIndex={0}
          data-testid={row.testId}
          onClick={(): void => { handleActivate(row) }}
          onKeyDown={(e): void => {
            if (e.key !== 'Enter' && e.key !== ' ') return
            e.preventDefault()
            handleActivate(row)
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '6px 8px',
            borderRadius: 4,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            color: 'var(--foreground)'
          }}
          onMouseEnter={(e): void => { e.currentTarget.style.background = 'var(--list-hoverBackground, rgba(128,128,128,0.08))' }}
          onMouseLeave={(e): void => { e.currentTarget.style.background = 'transparent' }}
        >
          <i className={`codicon codicon-${row.icon}`} aria-hidden="true" />
          <span data-testid={`${row.testId}-label`}>{row.label}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * Statusbar host for the path actions. `useStatusbarTooltip` must run
 * inside the `StatusbarElement` subtree — keeping this thin wrapper here
 * (rather than inlining at the call site) keeps that subtree boundary
 * explicit, mirroring `StatusbarEnvPopoverHost`.
 */
export const StatusbarPathActionsHost: React.FC<{ filePath: string }> = ({ filePath }) => {
  const { closeTooltip } = useStatusbarTooltip()
  return <StatusbarPathActionsList filePath={filePath} onCloseRequested={closeTooltip} />
}

export default StatusbarPathActionsHost
