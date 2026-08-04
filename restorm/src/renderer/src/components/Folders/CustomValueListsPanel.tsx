import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  KeyValueTable,
  type KeyValueTableHandle,
  type KeyValueTableRow,
  eventBus
} from 'electron-core-ui/renderer'
import type { EnvironmentFolder, CustomValueList, CustomValueEntry } from '../../../../shared/types/collections'
import { DocumentEvents, type DocumentChangedPayload } from '../../services/DocumentEvents'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'

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
 * (add / rename / delete, new list starts in edit mode). Right: the
 * selected list's entries in the shared `KeyValueTable` primitive, which
 * carries the enable toggle, the delete affordance and drag reordering.
 * These are 100% user-managed, never touched by spec re-import.
 *
 * The entries deliberately go through the plain ECUI table rather than
 * restorm's `RestormKeyValueTable`: an entry's `value` is a literal string
 * substituted at dispatch, so the typed-value cell would offer secrets,
 * dates and nested lists that the stored shape cannot round-trip.
 */
export const CustomValueListsPanel: React.FC<CustomValueListsPanelProps> = ({ folder, onFolderChange }) => {
  const { t } = useTranslation()
  const [lists, setLists] = useState<CustomValueList[]>(() => folder.customValueLists ?? [])
  const [selectedId, setSelectedId] = useState<string | null>(() => folder.customValueLists?.[0]?.id ?? null)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Latest committed lists, updated synchronously on every write. Text edits
  // now arrive debounced from inside InputBox, so a debounced `onChange` fires
  // its captured closure *after* the user may have made an intervening
  // immediate edit (e.g. toggled a sibling entry's checkbox). Computing the
  // next array from this ref — rather than the `lists`/`selected` snapshot the
  // closure captured — merges each field patch into the current entries, so a
  // late label/value commit can't revert that checkbox toggle.
  const listsRef = useRef(lists)

  // Re-sync from the folder prop on the next frame (mirrors the env panel).
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const fresh = folder.customValueLists ?? []
      listsRef.current = fresh
      setLists(fresh)
    })
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
    const api = window.restorm?.apiUpdate
    void api?.updateFolderCustomValueLists(folder.id, next as unknown as unknown[])
  }, [folder, onFolderChange])

  // Persist: update local state + write the folder. Per-keystroke text edits
  // arrive already debounced from InputBox (its onChange is debounced), so the
  // folder write + re-resolve no longer needs its own debounce here.
  // `listsRef` is updated synchronously so a same-tick follow-up read sees it.
  const persist = useCallback((next: CustomValueList[]) => {
    listsRef.current = next
    setLists(next)
    commit(next)
  }, [commit])

  const selected = useMemo(() => lists.find((l) => l.id === selectedId) ?? null, [lists, selectedId])

  const handleAdd = useCallback(() => {
    const id = genId('cvl')
    const newList: CustomValueList = { id, name: t('folderView.customValues.newListName'), entries: [] }
    persist([...listsRef.current, newList])
    setSelectedId(id)
    setEditingId(id)
  }, [persist, t])

  const handleRename = useCallback((id: string, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    persist(listsRef.current.map((l) => (l.id === id ? { ...l, name: trimmed } : l)))
  }, [persist])

  const handleDelete = useCallback((id: string) => {
    const next = listsRef.current.filter((l) => l.id !== id)
    persist(next)
    if (selectedId === id) setSelectedId(next[0]?.id ?? null)
  }, [persist, selectedId])

  const setEntries = useCallback((listId: string, entries: CustomValueEntry[]) => {
    const current = listsRef.current.find((l) => l.id === listId)
    // Ignore a write that changes nothing. Handed an empty list, the table
    // seeds a fresh blank row with a NEW id and reports it; that report
    // resolves back to "still empty", which would write again, which would
    // hand the table another empty list, which would mint another id — a
    // loop with no fixed point. Comparing what would be stored against what
    // IS stored gives it one.
    if (current && JSON.stringify(current.entries) === JSON.stringify(entries)) return
    const next = listsRef.current.map((l) => (l.id === listId ? { ...l, entries } : l))
    persist(next)
  }, [persist])

  // The pane's "+" lives in the header, above the table, so it adds a row
  // through the table's imperative handle rather than by writing an entry the
  // table would then have to adopt.
  const entriesTableRef = useRef<KeyValueTableHandle>(null)

  const entryRows = useMemo<KeyValueTableRow[]>(
    () => (selected?.entries ?? []).map((e) => ({
      id: e.id,
      key: e.label,
      value: e.value,
      enabled: e.enabled !== false
    })),
    [selected]
  )

  // The table owns the entry rows: adding, editing, toggling, deleting AND
  // reordering all come back through this one callback, already in the order
  // the user sees. The row ARRAY ORDER is the entry order — persisting it
  // verbatim is what makes a drag survive a save/reload round-trip, and what
  // the value pickers of already-open requests read back.
  const handleEntryRowsChange = useCallback((rows: KeyValueTableRow[]) => {
    if (!selectedId) return
    // A table with nothing in it always shows one empty row to type into.
    // That row is an affordance, not a value: storing it would leave a
    // label-less entry in the project file after the user deleted the last
    // one, and an unpickable blank line in every menu bound to the list. So
    // a table where NO row carries anything means the list is empty. A blank
    // row sitting among filled ones is left alone — the user is mid-edit and
    // dropping it would pull the row out from under them.
    const hasContent = rows.some((r) => r.key.trim() !== '' || r.value.trim() !== '')
    setEntries(selectedId, hasContent
      ? rows.map((r) => ({
        id: r.id ?? genId('cve'),
        label: r.key,
        value: r.value,
        enabled: r.enabled !== false
      }))
      : [])
  }, [selectedId, setEntries])

  const handleAddEntry = useCallback(() => {
    entriesTableRef.current?.addRow()
  }, [])

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
                <HeaderHoverTooltip label={t('folderView.customValues.addList')}>
                  <Button
                    secondary
                    small
                    icon="add"
                    options={{ ariaLabel: t('folderView.customValues.addList') }}
                    onClick={handleAdd}
                    data-testid="custom-values-add-list-button"
                  />
                </HeaderHoverTooltip>
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
                // A closed door, not a deferred feature: the lists are picked,
                // not arranged, and there is no order here worth dragging. Not
                // wiring `onItemDrop` would NOT have been enough — a draggable
                // row starts a real HTML5 drag stamped with the ListView marker
                // MIME, and the workbench's drop zone claims any gesture
                // carrying it, darkening the whole editor and swallowing the
                // release. The drag has to be refused at its source.
                disableDrag
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
                  <HeaderHoverTooltip label={t('folderView.customValues.addEntry')}>
                    <Button
                      secondary
                      small
                      icon="add"
                      options={{ ariaLabel: t('folderView.customValues.addEntry') }}
                      onClick={handleAddEntry}
                      data-testid="custom-values-add-entry-button"
                    />
                  </HeaderHoverTooltip>
                }
              >
                <div style={{ padding: 8, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                  {/* A list with no values shows the table's own empty row rather
                      than an italic "no values yet" line: the row is where the
                      user types the first value, and a placeholder next to it
                      would label a field that is ready for input as absent.
                      Bringing the line back means rendering it above this table
                      when `selected.entries.length === 0` — the table stays as
                      it is either way. */}
                  <KeyValueTable
                    // Remount on list switch: the table seeds its rows once and
                    // then only adopts props that differ from what it emitted,
                    // so sharing one instance across lists would have it argue
                    // with itself about whose rows are authoritative.
                    key={selected.id}
                    ref={entriesTableRef}
                    initialRows={entryRows}
                    onRowsChange={handleEntryRowsChange}
                    keyHeader={t('folderView.customValues.label')}
                    valueHeader={t('folderView.customValues.value')}
                    showDescription={false}
                    persistenceId={`custom-value-list:${folder.id}`}
                    data-testid="custom-values-entries-table"
                  />
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
