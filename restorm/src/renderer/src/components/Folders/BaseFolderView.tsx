import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Tabs,
  type Tab,
  MarkdownEditor,
  fieldDiffStyle
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
  /** Conflict-resolution field-diff (AC#4): when true, red-borders the
   * notes editor (`fieldDiffStyle`) — the ONLY field this panel exposes
   * that a folder-level conflict can highlight. Also nudges the default
   * active tab to `notes` (unless `defaultActiveTabId` already picks one
   * explicitly), satisfying AC#5's "preselect the conflict-bearing tab".
   * Only ever passed from `ConflictEntityPanel`; `undefined`/`false` in
   * the live (non-conflict) editor. */
  notesDiffers?: boolean
  /** Ids of the tabs a folder-level conflict actually contests (e.g.
   * `environments`, `custom-values`, `home`). Their content gets the same
   * red border as a contested notes editor, so the user can see WHICH tab
   * to arbitrate instead of comparing two environment trees by eye.
   * Only ever passed from `ConflictEntityPanel`. */
  contestedTabIds?: string[]
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
  onSwitchTabReady,
  notesDiffers,
  contestedTabIds
}) => {
  const { t } = useTranslation()
  const testIdBase = `folder-view-${folder.id}`

  const hasDocs = docsContent !== undefined && docsContent !== null

  const defaultTabId = defaultActiveTabId
    ?? (notesDiffers ? 'notes' : undefined)
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
      <div style={{ height: '100%', boxSizing: 'border-box', border: '1px solid transparent', ...fieldDiffStyle(!!notesDiffers) }}>
        <MarkdownEditor
          initialValue={folder.notes ?? ''}
          onChange={handleNotesChange}
          data-testid={`${testIdBase}-markdown-editor-notes`}
        />
      </div>
    )
  })

  const contested = new Set(contestedTabIds ?? [])
  const highlightedAdditionalTabs = contested.size === 0
    ? additionalTabs
    : additionalTabs.map((tab) => (contested.has(tab.id)
      ? {
        ...tab,
        content: (
          <div style={{ height: '100%', boxSizing: 'border-box', border: '1px solid transparent', ...fieldDiffStyle(true) }}>
            {tab.content}
          </div>
        )
      }
      : tab))

  const allTabs = [...highlightedAdditionalTabs, ...docsTabs]

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
