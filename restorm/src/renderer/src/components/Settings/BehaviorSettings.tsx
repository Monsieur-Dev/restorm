import React from 'react'
import { useTranslation } from 'react-i18next'
import { Toggle, useStorage } from 'electron-core-ui/renderer'

/**
 * Behavior settings section for the settings modal.
 * Contains the "sync sidebar with tabs" toggle.
 */
const BehaviorSettings: React.FC = () => {
  const { t } = useTranslation()
  const [syncSidebarWithTabs, setSyncSidebarWithTabs, isLoading] = useStorage<boolean>('behavior.syncSidebarWithTabs', true)

  if (isLoading) return null

  return (
    <div className="settings-item" data-testid="behavior-settings">
      <h1 className="settings-label">
        {t('behavior.title', 'Behavior')}
      </h1>
      <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', cursor: 'pointer' }}>
        <Toggle
          data-testid="sync-sidebar-toggle"
          isChecked={syncSidebarWithTabs}
          onChange={(checked: boolean) => { setSyncSidebarWithTabs(checked) }}
          
        >
          <span
            role="button"
            tabIndex={0}
            onClick={() => { setSyncSidebarWithTabs(!syncSidebarWithTabs) }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSyncSidebarWithTabs(!syncSidebarWithTabs) } }}
          >
            <span>{t('behavior.syncSidebarWithTabs', 'Sync sidebar selection with active tab')}</span>
            <br />
            <span style={{ fontSize: '11px', color: 'var(--descriptionForeground)' }}>
              {t('behavior.syncSidebarWithTabsDescription', 'When switching tabs in the workspace, automatically select and reveal the corresponding item in the sidebar')}
            </span>
          </span>
        </Toggle>
      </label>
    </div>
  )
}

export default BehaviorSettings
