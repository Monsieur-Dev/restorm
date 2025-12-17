import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Tabs,
  type Tab,
  MarkdownEditor,
  MarkdownViewer
} from 'electron-core-ui/renderer'
import type { Folder } from '../types/collections'

export interface FolderViewProps {
  /** The folder to display */
  folder: Folder
  /** Called when folder data changes */
  onFolderChange?: (folder: Folder) => void
}

export const FolderView: React.FC<FolderViewProps> = ({ folder, onFolderChange }) => {
  const { t } = useTranslation()
  const [activeTabId, setActiveTabId] = useState<string>('docs')

  // Suppress unused warning - kept for API compatibility
  void onFolderChange

  const tabs: Tab[] = [
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
        tabs={tabs}
        activeTabId={activeTabId}
        onTabChange={setActiveTabId}
      />
    </div>
  )
}

export default FolderView
