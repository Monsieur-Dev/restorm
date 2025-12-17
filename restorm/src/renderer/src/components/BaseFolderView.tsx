import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Tabs,
  type Tab,
  MarkdownEditor,
  MarkdownViewer
} from 'electron-core-ui/renderer'
import type { Folder, EnvironmentFolder } from '../types/collections'

export interface BaseFolderViewProps {
  /** The folder to display (Folder or EnvironmentFolder) */
  folder: Folder | EnvironmentFolder
  /** Additional tabs to prepend before docs/notes */
  additionalTabs?: Tab[]
  /** Default active tab ID (defaults to first additional tab or 'docs') */
  defaultActiveTabId?: string
}

/**
 * Base component for folder views with documentation tabs (docs + notes).
 * Can be extended with additional tabs prepended before the standard ones.
 */
export const BaseFolderView: React.FC<BaseFolderViewProps> = ({
  folder,
  additionalTabs = [],
  defaultActiveTabId
}) => {
  const { t } = useTranslation()
  
  const defaultTabId = defaultActiveTabId ?? additionalTabs[0]?.id ?? 'docs'
  const [activeTabId, setActiveTabId] = useState<string>(defaultTabId)

  const docsTabs: Tab[] = [
    {
      id: 'docs',
      label: t('folderView.tabs.docs'),
      useScrollableElement: false,
      content: (
        <MarkdownViewer
          value={folder.documentation || `# ${folder.name}\n\nNo documentation available.`}
        />
      )
    },
    {
      id: 'notes',
      label: t('folderView.tabs.notes'),
      useScrollableElement: false,
      content: (
        <MarkdownEditor
          initialValue={folder.notes ?? ''}
          onChange={(markdown) => {
            folder.notes = markdown
          }}
        />
      )
    }
  ]

  const allTabs = [...additionalTabs, ...docsTabs]

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        minWidth: 0
      }}
    >
      <Tabs
        tabs={allTabs}
        activeTabId={activeTabId}
        onTabChange={setActiveTabId}
      />
    </div>
  )
}

export default BaseFolderView
