import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Tabs,
  type Tab,
  MarkdownEditor
} from 'electron-core-ui/renderer'
import type { Folder, EnvironmentFolder } from '../../../../shared/types/collections'

// Helper to update reactive proxy properties (intentional mutation for reactive objects)
// Uses direct property assignment to trigger proxy setter
function updateReactiveProperty<T extends object, K extends keyof T>(obj: T, key: K, value: T[K]): void {
  // Direct assignment triggers the proxy's set trap
  (obj as Record<K, T[K]>)[key] = value
}

export interface BaseFolderViewProps {
  /** The folder to display (Folder or EnvironmentFolder) */
  folder: Folder | EnvironmentFolder
  /** Additional tabs to prepend before docs/notes */
  additionalTabs?: Tab[]
  /** Default active tab ID (defaults to first additional tab or 'docs') */
  defaultActiveTabId?: string
  /** Callback receiving the setActiveTabId function when the component mounts. */
  onSwitchTabReady?: (switchTab: (tabId: string) => void) => void
  /** Structured documentation content rendered as the Docs tab.
   * EnvironmentFolderView and FolderView use this to surface a
   * `<DocumentationHost />`. The Docs tab is omitted when this is
   * undefined — there's no fallback markdown source. */
  docsContent?: React.ReactNode
}

/**
 * Base component for folder views with documentation tabs (docs + notes).
 * Can be extended with additional tabs prepended before the standard ones.
 */
export const BaseFolderView: React.FC<BaseFolderViewProps> = ({
  folder,
  additionalTabs = [],
  defaultActiveTabId,
  docsContent,
  onSwitchTabReady
}) => {
  const { t } = useTranslation()
  const testIdBase = `folder-view-${folder.id}`

  const hasDocs = docsContent !== undefined && docsContent !== null

  const defaultTabId = defaultActiveTabId
    ?? additionalTabs[0]?.id
    ?? (hasDocs ? 'docs' : 'notes')
  const [activeTabId, setActiveTabId] = useState<string>(defaultTabId)

  useEffect(() => {
    onSwitchTabReady?.(setActiveTabId)
  }, [onSwitchTabReady, setActiveTabId])

  const effectiveActiveTabId = activeTabId === 'docs' && !hasDocs ? 'notes' : activeTabId

  const handleNotesChange = useCallback((markdown: string): void => {
    const normalized = markdown.trim() ? markdown : undefined
    updateReactiveProperty(folder, 'notes', normalized)
  }, [folder])

  const docsTabs: Tab[] = []
  if (hasDocs) {
    docsTabs.push({
      id: 'docs',
      label: t('folderView.tabs.docs'),
      // DocumentationHost owns its own scroll contexts (Dock-bounded
      // sidebar + an inner ScrollableElement on the main column),
      // so the Tabs wrapper must NOT wrap it in an outer
      // ScrollableElement — that would unbound the Dock's height
      // and starve the inner sidebar of overflow to scroll.
      useScrollableElement: false,
      content: docsContent
    })
  }
  docsTabs.push({
    id: 'notes',
    label: t('folderView.tabs.notes'),
    useScrollableElement: false,
    content: (
      <MarkdownEditor
        initialValue={folder.notes ?? ''}
        onChange={handleNotesChange}
        data-testid={`${testIdBase}-markdown-editor-notes`}
      />
    )
  })

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
        activeTabId={effectiveActiveTabId}
        onTabChange={setActiveTabId}
        data-testid={`${testIdBase}-tabs`}
      />
    </div>
  )
}

export default BaseFolderView
