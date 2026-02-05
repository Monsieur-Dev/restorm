import React, { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SettingsTreeView } from 'electron-core-ui/renderer'

interface SettingsSchemaLocal {
  categories: Record<string, SettingCategoryLocal>
}

interface SettingCategoryLocal {
  key: string
  name: string
  categories?: Record<string, SettingCategoryLocal>
  settings?: Record<string, unknown>
}

const SettingsTreeViewE2ETab: React.FC = () => {
  const { t } = useTranslation()
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState<string>('')

  const schema = useMemo((): SettingsSchemaLocal => ({
    categories: {
      general: {
        key: 'general',
        name: t('settingsTreeView.harness.categories.general'),
        categories: {
          appearance: {
            key: 'appearance',
            name: t('settingsTreeView.harness.categories.appearance'),
            categories: {
              theme: {
                key: 'theme',
                name: t('settingsTreeView.harness.categories.theme'),
                settings: { enabled: true }
              }
            }
          }
        }
      },
      workspace: {
        key: 'workspace',
        name: t('settingsTreeView.harness.categories.workspace'),
        settings: { enabled: true }
      }
    }
  }), [t])

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value)
  }, [])

  return (
    <div style={{ padding: 16, display: 'flex', gap: 16 }}>
      <div style={{ width: 360 }}>
        <div style={{ marginBottom: 8 }}>
          {t('settingsTreeView.harness.instructions')}
        </div>

        <input
          data-testid="settingstreeview-e2e-search"
          value={searchQuery}
          onChange={handleSearchChange}
          placeholder={t('settingsTreeView.harness.searchPlaceholder')}
          style={{ width: '100%', marginBottom: 12 }}
        />

        <SettingsTreeView
          data-testid="settingstreeview-e2e"
          schema={schema}
          selectedCategory={selectedCategory}
          onSelectCategory={setSelectedCategory}
          searchQuery={searchQuery}
        />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div data-testid="settingstreeview-e2e-ready">true</div>
        <div data-testid="settingstreeview-e2e-selected">{selectedCategory ?? ''}</div>
      </div>
    </div>
  )
}

export default SettingsTreeViewE2ETab
