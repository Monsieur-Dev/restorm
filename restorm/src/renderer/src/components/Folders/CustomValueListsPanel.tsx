import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ListView,
  type ListViewItemData,
  type ListViewItemEventPayload,
  type ContextMenuItem,
  VerticalSashContainer,
  SplitView,
  Pane,
  Button,
  InputBox,
  eventBus,
  useDebouncedCallback
} from 'electron-core-ui/renderer'
import type { EnvironmentFolder, CustomValueList, CustomValueEntry } from '../../../../shared/types/collections'
import { DocumentEvents, type DocumentChangedPayload } from '../../services/DocumentEvents'

const MIN_LEFT_WIDTH = 160
const RIGHT_MIN_WIDTH = 240

function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** Direct assignment triggers the reactive proxy's set trap. */
function updateReactiveProperty<T extends object, K extends keyof T>(obj: T, key: K, value: T[K]): void {
  (obj as Record<K, T[K]>)[key] = value
}

export interface CustomValueListsPanelProps {
  folder: EnvironmentFolder
  onFolderChange?: ((folder: EnvironmentFolder) => void) | undefined
}

/**
 * Master-details editor for an env folder's user-defined custom value
 * lists ("Variables personnalisées"). Left: the list of named lists
 * (add / rename / delete, new list starts in edit mode). Right: a
 * label → value table for the selected list (add / edit / delete).
 * These are 100% user-managed, never touched by spec re-import.
 */
export const CustomValueListsPanel: React.FC<CustomValueListsPanelProps> = ({ folder, onFolderChange }) => {
  const { t } = useTranslation()
  const [lists, setLists] = useState<CustomValueList[]>(() => folder.customValueLists ?? [])
  const [selectedId, setSelectedId] = useState<string | null>(() => folder.customValueLists?.[0]?.id ?? null)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Re-sync from the folder prop on the next frame (mirrors the env panel).
  useEffect(() => {
    const raf = requestAnimationFrame(() => { setLists(folder.customValueLists ?? []) })
    return (): void => { cancelAnimationFrame(raf) }
  }, [folder.customValueLists])

  // Heavy write: mutate the reactive folder + notify the parent + fire
  // FOLDER_UPDATED so open request tabs re-read the lists (the KV-table
  // dropdown drops an unchecked entry instantly). `customValueLists`
  // isn't an indexable folder key, so the proxy doesn't auto-emit.
  const commit = useCallback((next: CustomValueList[]) => {
    updateReactiveProperty(folder, 'customValueLists', next)
    onFolderChange?.({ ...folder, customValueLists: next })
    eventBus.emitLocalSync(DocumentEvents.FOLDER_UPDATED, {
      type: 'folder',
      id: folder.id,
      document: folder
    } as DocumentChangedPayload)
    // Push the change to the main-side CollectionStore so the dispatch
    // resolver substitutes the new entry values. The reactive mutation
    // above stays in-renderer (in-place edits skip the sync memo), so
    // without this targeted IPC main keeps resolving the stale snapshot.
    const api = (window as unknown as {
      restorm?: { apiUpdate?: { updateFolderCustomValueLists?: (folderId: string, lists: unknown[]) => Promise<void> } }
    }).restorm?.apiUpdate
    void api?.updateFolderCustomValueLists?.(folder.id, next as unknown as unknown[])
  }, [folder, onFolderChange])

  // Debounced commit for per-keystroke text edits (label / value), so a
  // burst of typing doesn't fire a folder write + re-resolve every open
  // request on every character.
  const commitDebounced = useDebouncedCallback(commit, 350)

  // Flush any pending text edit when the panel unmounts so the last few
  // characters aren't dropped on tab close / navigation.
  useEffect(() => () => { commitDebounced.flush() }, [commitDebounced])

  // Immediate persist: local state + folder write now. Cancels any
  // pending debounced text commit so it can't clobber with stale data.
  const persist = useCallback((next: CustomValueList[]) => {
    setLists(next)
    commitDebounced.cancel()
    commit(next)
  }, [commit, commitDebounced])

  // Local state now, folder write debounced (text fields).
  const persistDebounced = useCallback((next: CustomValueList[]) => {
    setLists(next)
    commitDebounced(next)
  }, [commitDebounced])

  const selected = useMemo(() => lists.find((l) => l.id === selectedId) ?? null, [lists, selectedId])

  const handleAdd = useCallback(() => {
    const id = genId('cvl')
    const newList: CustomValueList = { id, name: t('folderView.customValues.newListName'), entries: [] }
    persist([...lists, newList])
    setSelectedId(id)
    setEditingId(id)
  }, [lists, persist, t])

  const handleRename = useCallback((id: string, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    persist(lists.map((l) => (l.id === id ? { ...l, name: trimmed } : l)))
  }, [lists, persist])

  const handleDelete = useCallback((id: string) => {
    const next = lists.filter((l) => l.id !== id)
    persist(next)
    if (selectedId === id) setSelectedId(next[0]?.id ?? null)
  }, [lists, persist, selectedId])

  const setEntries = useCallback((listId: string, entries: CustomValueEntry[], debounced = false) => {
    const next = lists.map((l) => (l.id === listId ? { ...l, entries } : l))
    if (debounced) persistDebounced(next)
    else persist(next)
  }, [lists, persist, persistDebounced])

  const handleAddEntry = useCallback(() => {
    if (!selected) return
    setEntries(selected.id, [...selected.entries, { id: genId('cve'), label: '', value: '' }])
  }, [selected, setEntries])

  // Text edits (label / value) debounce the folder write; the checkbox
  // (enabled) commits immediately.
  const handleEntryText = useCallback((entryId: string, patch: Partial<CustomValueEntry>) => {
    if (!selected) return
    setEntries(selected.id, selected.entries.map((e) => (e.id === entryId ? { ...e, ...patch } : e)), true)
  }, [selected, setEntries])

  const handleEntryEnabled = useCallback((entryId: string, enabled: boolean) => {
    if (!selected) return
    setEntries(selected.id, selected.entries.map((e) => (e.id === entryId ? { ...e, enabled } : e)))
  }, [selected, setEntries])

  const handleEntryDelete = useCallback((entryId: string) => {
    if (!selected) return
    setEntries(selected.id, selected.entries.filter((e) => e.id !== entryId))
  }, [selected, setEntries])

  // `ContextMenuItem.onClick` receives no payload — it acts on the
  // row the user right-clicked, which `onItemContextMenu` has already
  // promoted to `selectedId`.
  const contextMenuItems: ContextMenuItem[] = useMemo(() => ([
    { id: 'rename', label: t('sidebar.contextMenu.rename'), icon: 'edit', onClick: () => { if (selectedId) setEditingId(selectedId) } },
    { id: 'delete', label: t('sidebar.contextMenu.delete'), icon: 'trash', onClick: () => { if (selectedId) handleDelete(selectedId) } }
  ]), [t, handleDelete, selectedId])

  const items: ListViewItemData[] = useMemo(
    () => lists.map((l) => ({ id: l.id, title: l.name, isExpandable: false, isExpanded: false, contextMenuItems })),
    [lists, contextMenuItems]
  )

  return (
    <VerticalSashContainer
      data-testid="custom-values-sash-container"
      Left={
        <div
          style={{
            display: 'flex', flexDirection: 'column', width: '100%', minWidth: 0, minHeight: 0, height: '100%',
            borderRight: '1px solid var(--sideBar-border)', backgroundColor: 'var(--sideBar-background)'
          }}
        >
          <SplitView orientation="vertical" style={{ width: '100%', height: '100%' }}>
            <Pane
              title={t('folderView.customValues.lists')}
              collapsible={false}
              minSize={MIN_LEFT_WIDTH}
              data-testid="custom-values-lists-pane"
              headerActions={
                <Button
                  secondary
                  small
                  icon="add"
                  options={{ ariaLabel: t('folderView.customValues.addList'), title: t('folderView.customValues.addList') }}
                  onClick={handleAdd}
                  data-testid="custom-values-add-list-button"
                />
              }
            >
              <ListView
                items={items}
                rootRole="tree"
                ariaLabel={t('folderView.customValues.lists')}
                selectedIds={selectedId ? [selectedId] : []}
                editingItemId={editingId}
                onEditingStart={(id) => { setEditingId(id) }}
                onEditingEnd={() => { setEditingId(null) }}
                isRenameable
                data-testid="custom-values-list"
                onItemClick={(payload) => { if (payload.item.id) setSelectedId(payload.item.id) }}
                onItemRename={(payload: ListViewItemEventPayload, newValue: string) => { handleRename(payload.item.id, newValue) }}
                onItemContextMenu={(payload) => { setSelectedId(payload.item.id) }}
              />
            </Pane>
          </SplitView>
        </div>
      }
      Right={
        <div style={{ minHeight: 0, display: 'flex', boxSizing: 'border-box', backgroundColor: 'var(--editor-background)' }}>
          <SplitView orientation="vertical" style={{ width: '100%', height: '100%' }}>
            {selected ? (
              <Pane
                title={`${t('folderView.customValues.values')} - ${selected.name}`}
                collapsible={false}
                minSize={80}
                data-testid="custom-values-entries-pane"
                headerActions={
                  <Button
                    secondary
                    small
                    icon="add"
                    options={{ ariaLabel: t('folderView.customValues.addEntry'), title: t('folderView.customValues.addEntry') }}
                    onClick={handleAddEntry}
                    data-testid="custom-values-add-entry-button"
                  />
                }
              >
                <div style={{ padding: 8, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', gap: 8, fontSize: 12, color: 'var(--descriptionForeground)', padding: '0 2px', alignItems: 'center' }}>
                    <span style={{ width: 13, flexShrink: 0 }} />
                    <span style={{ flex: 1 }}>{t('folderView.customValues.label')}</span>
                    <span style={{ flex: 1 }}>{t('folderView.customValues.value')}</span>
                    <span style={{ width: 28 }} />
                  </div>
                  {selected.entries.map((entry) => (
                    <div key={entry.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }} data-testid={`custom-values-entry-${entry.id}`}>
                      <input
                        type="checkbox"
                        checked={entry.enabled !== false}
                        onChange={(e) => { handleEntryEnabled(entry.id, e.target.checked) }}
                        aria-label={t('folderView.customValues.enabled')}
                        title={t('folderView.customValues.enabled')}
                        data-testid={`custom-values-entry-enabled-${entry.id}`}
                        style={{ flexShrink: 0, cursor: 'pointer' }}
                      />
                      <div style={{ flex: 1, minWidth: 0, opacity: entry.enabled === false ? 0.5 : 1 }}>
                        <InputBox
                          value={entry.label}
                          onChange={(next) => { handleEntryText(entry.id, { label: next }) }}
                          options={{ type: 'text', placeholder: t('folderView.customValues.label') }}
                          data-testid={`custom-values-entry-label-${entry.id}`}
                        />
                      </div>
                      <div style={{ flex: 1, minWidth: 0, opacity: entry.enabled === false ? 0.5 : 1 }}>
                        <InputBox
                          value={entry.value}
                          onChange={(next) => { handleEntryText(entry.id, { value: next }) }}
                          options={{ type: 'text', placeholder: t('folderView.customValues.value') }}
                          data-testid={`custom-values-entry-value-${entry.id}`}
                        />
                      </div>
                      <Button
                        secondary
                        small
                        icon="trash"
                        options={{ ariaLabel: t('sidebar.contextMenu.delete'), title: t('sidebar.contextMenu.delete') }}
                        onClick={() => { handleEntryDelete(entry.id) }}
                        data-testid={`custom-values-entry-delete-${entry.id}`}
                      />
                    </div>
                  ))}
                  {selected.entries.length === 0 && (
                    <div style={{ color: 'var(--descriptionForeground)', fontStyle: 'italic', padding: 8 }}>
                      {t('folderView.customValues.noEntries')}
                    </div>
                  )}
                </div>
              </Pane>
            ) : (
              <Pane title={t('folderView.customValues.values')} collapsible={false} minSize={80} data-testid="custom-values-entries-pane">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--descriptionForeground)', fontStyle: 'italic', padding: 16 }}>
                  {t('folderView.customValues.selectList')}
                </div>
              </Pane>
            )}
          </SplitView>
        </div>
      }
      initialWidth={260}
      minLeftWidth={MIN_LEFT_WIDTH}
      minRightWidth={RIGHT_MIN_WIDTH}
      sashConfig={{ size: 4 }}
      className="custom-values-panel"
    />
  )
}

export default CustomValueListsPanel
