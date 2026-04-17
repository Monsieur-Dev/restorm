import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Tabs,
  type Tab,
  MarkdownEditor,
  MarkdownViewer
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
  /**
   * Override for the Docs tab's Markdown content. When provided, this string
   * is rendered instead of `folder.documentation`; an empty string hides the
   * Docs tab entirely. Used by EnvironmentFolderView to inject the compiled
   * root.hbs output.
   */
  documentationOverride?: string
  /** Node rendered above the Docs tab markdown (e.g., a Refresh button). */
  docsHeader?: React.ReactNode
}

/**
 * Base component for folder views with documentation tabs (docs + notes).
 * Can be extended with additional tabs prepended before the standard ones.
 */
export const BaseFolderView: React.FC<BaseFolderViewProps> = ({
  folder,
  additionalTabs = [],
  defaultActiveTabId,
  documentationOverride,
  docsHeader,
  onSwitchTabReady
}) => {
  const { t } = useTranslation()
  const testIdBase = `folder-view-${folder.id}`

  const docs = documentationOverride ?? folder.documentation
  const hasDocs = docs.trim().length > 0

  const defaultTabId = defaultActiveTabId
    ?? additionalTabs[0]?.id
    ?? (hasDocs ? 'docs' : 'notes')
  const [activeTabId, setActiveTabId] = useState<string>(defaultTabId)

  // Expose setActiveTabId to parent
  useEffect(() => {
    onSwitchTabReady?.(setActiveTabId)
  }, [onSwitchTabReady, setActiveTabId])

  // Fall back to Notes at render time when the Docs tab disappears — avoids a
  // sync setState in effect (banned by react-hooks/set-state-in-effect).
  const effectiveActiveTabId = activeTabId === 'docs' && !hasDocs ? 'notes' : activeTabId

  const handleNotesChange = useCallback((markdown: string): void => {
    updateReactiveProperty(folder, 'notes', markdown)
  }, [folder])

  const docsTabs: Tab[] = []
  if (hasDocs) {
    docsTabs.push({
      id: 'docs',
      label: t('folderView.tabs.docs'),
      useScrollableElement: false,
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
          {docsHeader}
          <div style={{ flex: 1, minHeight: 0 }}>
            <MarkdownViewer
              value={docs || `# ${folder.name}\n\nNo documentation available.`}
              data-testid={`${testIdBase}-markdown-viewer-docs`}
            />
          </div>
        </div>
      )
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
