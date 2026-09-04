import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ListView,
  type ListViewItemData,
  type ListViewItemEventPayload,
  type ListViewDropEventPayload,
  type ContextMenuItem,
  VerticalSashContainer,
  SplitView,
  Pane,
  Button,
  InputBox,
  KeyValueTable,
  type KeyValueTableHandle,
  type KeyValueTableRow
} from 'electron-core-ui/renderer'
import type { CustomValueList, CustomValueEntry } from '../../../../shared/types/collections'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'

const MIN_LEFT_WIDTH = 160
const RIGHT_MIN_WIDTH = 240

function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** Wording slots so the SAME editor can read as "custom value lists"
 * in an env folder and as "enums" in a design — every string is
 * already translated by the caller (or left to the folder defaults). */
export interface CustomValueListsWording {
  listsTitle: string
  addList: string
  valuesTitle: string
  addEntry: string
  selectList: string
  newListName: string
  keyHeader: string
  valueHeader: string
  filterPlaceholder: string
}

export interface CustomValueListsEditorProps {
  /** Source of truth. The editor keeps a local working copy (debounced
   * text edits merge against the latest committed write) and re-syncs
   * when this prop changes. */
  lists: CustomValueList[]
  /** Called with the FULL next lists array on every user edit —
   * persistence (folder write, design mutation) belongs to the caller. */
  onListsChange: (next: CustomValueList[]) => void
  /** localStorage key for the entries table's column widths. */
  entriesPersistenceId: string
  /** Wording overrides — defaults spell the env-folder surface. */
  wording?: Partial<CustomValueListsWording>
  /** Forwarded to the entries table: hide the enable toggle / value
   * column for single-column lists (design enums). */
  showEnabledToggle?: boolean
  showValue?: boolean
  /** Locks every edit affordance (plan gating). */
  disabled?: boolean
  /** Test-id prefix (default `custom-values`, the historical ids). */
  testIdPrefix?: string
  /** Show a filter field above the lists (design enums opt in; the env
   * folder keeps its filter-free list). */
  filterable?: boolean
  /** Allow drag-reordering the lists (design enums opt in; env folders keep
   * their pick-only list — reorder there would fight the workbench overlay). */
  reorderableLists?: boolean
  /** Optional slot rendered in the values pane, above the entries table, for
   * the currently-selected list. Design enums use it to edit the enum-level
   * description — a concern the shared list model doesn't carry, so it stays
   * with the caller rather than in this editor. */
  renderSelectedListExtra?: (listId: string) => React.ReactNode
}

/**
 * Master-details editor for named value lists — THE component behind
 * both the env folder's custom value lists and a design's enums (same
 * component, not a copy; the ticket's data-model question is settled as
 * a bridge: each surface maps its own storage to `CustomValueList[]`).
 * Left: the named lists (add / rename / delete, a new list starts in
 * edit mode). Right: the selected list's entries in the shared
 * `KeyValueTable`, which carries the enable toggle, the delete
 * affordance and drag reordering.
 */
export const CustomValueListsEditor: React.FC<CustomValueListsEditorProps> = ({
  lists: listsProp,
  onListsChange,
  entriesPersistenceId,
  wording,
  showEnabledToggle = true,
  showValue = true,
  disabled = false,
  testIdPrefix = 'custom-values',
  filterable = false,
  reorderableLists = false,
  renderSelectedListExtra
}) => {
  const { t } = useTranslation()
  const words: CustomValueListsWording = {
    listsTitle: wording?.listsTitle ?? t('folderView.customValues.lists'),
    addList: wording?.addList ?? t('folderView.customValues.addList'),
    valuesTitle: wording?.valuesTitle ?? t('folderView.customValues.values'),
    addEntry: wording?.addEntry ?? t('folderView.customValues.addEntry'),
    selectList: wording?.selectList ?? t('folderView.customValues.selectList'),
    newListName: wording?.newListName ?? t('folderView.customValues.newListName'),
    keyHeader: wording?.keyHeader ?? t('folderView.customValues.label'),
    valueHeader: wording?.valueHeader ?? t('folderView.customValues.value'),
    filterPlaceholder: wording?.filterPlaceholder ?? t('design.list.filter', 'Filter…')
  }
  const [listFilter, setListFilter] = useState('')

  const [lists, setLists] = useState<CustomValueList[]>(() => listsProp)
  const [selectedId, setSelectedId] = useState<string | null>(() => listsProp[0]?.id ?? null)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Latest committed lists, updated synchronously on every write. Text edits
  // arrive debounced from inside InputBox, so a debounced `onChange` fires
  // its captured closure *after* the user may have made an intervening
  // immediate edit (e.g. toggled a sibling entry's checkbox). Computing the
  // next array from this ref — rather than the `lists`/`selected` snapshot the
  // closure captured — merges each field patch into the current entries, so a
  // late label/value commit can't revert that checkbox toggle.
  const listsRef = useRef(lists)

  // Re-sync from the prop on the next frame (mirrors the env panel).
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      listsRef.current = listsProp
      setLists(listsProp)
    })
    return (): void => { cancelAnimationFrame(raf) }
  }, [listsProp])

  // Persist: update local state + hand the caller the full next array.
  // `listsRef` is updated synchronously so a same-tick follow-up read sees it.
  const persist = useCallback((next: CustomValueList[]) => {
    listsRef.current = next
    setLists(next)
    onListsChange(next)
  }, [onListsChange])

  const selected = useMemo(() => lists.find((l) => l.id === selectedId) ?? null, [lists, selectedId])

  const handleAdd = useCallback(() => {
    const id = genId('cvl')
    const newList: CustomValueList = { id, name: words.newListName, entries: [] }
    persist([...listsRef.current, newList])
    setSelectedId(id)
    setEditingId(id)
  }, [persist, words.newListName])

  const handleRename = useCallback((id: string, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    persist(listsRef.current.map((l) => (l.id === id ? { ...l, name: trimmed } : l)))
  }, [persist])

  // Flat drag-reorder (opt-in via `reorderableLists`): move the dragged list
  // before/after the drop target. `into` is meaningless for a flat list.
  const handleListReorder = useCallback((payload: ListViewDropEventPayload) => {
    if (disabled || payload.sources.length !== 1 || payload.position === 'into') return
    const draggedId = payload.source.id
    const targetId = payload.item.id
    if (!draggedId || !targetId || draggedId === targetId) return
    const arr = [...listsRef.current]
    const from = arr.findIndex((l) => l.id === draggedId)
    if (from < 0 || arr.findIndex((l) => l.id === targetId) < 0) return
    const [moved] = arr.splice(from, 1)
    if (moved === undefined) return
    const insertAt = arr.findIndex((l) => l.id === targetId) + (payload.position === 'after' ? 1 : 0)
    arr.splice(insertAt, 0, moved)
    persist(arr)
  }, [disabled, persist])

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
  const contextMenuItems: ContextMenuItem[] = useMemo(() => (disabled ? [] : [
    { id: 'rename', label: t('sidebar.contextMenu.rename'), icon: 'edit', onClick: () => { if (selectedId) setEditingId(selectedId) } },
    { id: 'delete', label: t('sidebar.contextMenu.delete'), icon: 'trash', onClick: () => { if (selectedId) handleDelete(selectedId) } }
  ]), [t, handleDelete, selectedId, disabled])

  const items: ListViewItemData[] = useMemo(
    () => lists.map((l) => ({ id: l.id, title: l.name, isExpandable: false, isExpanded: false, contextMenuItems })),
    [lists, contextMenuItems]
  )
  const visibleItems: ListViewItemData[] = useMemo(() => {
    const term = listFilter.trim().toLowerCase()
    if (term === '') return items
    // Filter on the source list NAME (a string), not the row title (a
    // ReactNode) — stringifying the latter yields '[object Object]'.
    const keep = new Set(lists.filter((l) => l.name.toLowerCase().includes(term)).map((l) => l.id))
    return items.filter((i) => keep.has(i.id))
  }, [items, lists, listFilter])

  return (
    <VerticalSashContainer
      data-testid={`${testIdPrefix}-sash-container`}
      Left={
        <div
          style={{
            display: 'flex', flexDirection: 'column', width: '100%', minWidth: 0, minHeight: 0, height: '100%',
            borderRight: '1px solid var(--sideBar-border)', backgroundColor: 'var(--sideBar-background)'
          }}
        >
          <SplitView orientation="vertical" style={{ width: '100%', height: '100%' }}>
            <Pane
              title={words.listsTitle}
              collapsible={false}
              minSize={MIN_LEFT_WIDTH}
              data-testid={`${testIdPrefix}-lists-pane`}
              headerActions={disabled ? undefined : (
                <HeaderHoverTooltip label={words.addList}>
                  <Button
                    secondary
                    small
                    icon="add"
                    options={{ ariaLabel: words.addList }}
                    onClick={handleAdd}
                    data-testid={`${testIdPrefix}-add-list-button`}
                  />
                </HeaderHoverTooltip>
              )}
            >
              {filterable && (
                <InputBox
                  value={listFilter}
                  onChange={setListFilter}
                  options={{ type: 'text', placeholder: words.filterPlaceholder, ariaLabel: words.filterPlaceholder }}
                  data-testid={`${testIdPrefix}-list-filter`}
                />
              )}
              <ListView
                items={visibleItems}
                rootRole="tree"
                ariaLabel={words.listsTitle}
                selectedIds={selectedId ? [selectedId] : []}
                editingItemId={editingId}
                onEditingStart={(id) => { if (!disabled) setEditingId(id) }}
                onEditingEnd={() => { setEditingId(null) }}
                isRenameable={!disabled}
                // Reorder is OPT-IN (`reorderableLists`). When off, drag is
                // refused at its source: a draggable row starts a real HTML5
                // drag stamped with the ListView marker MIME, and outside a
                // reorder-scoped host (see App's `isWorkbenchExternalDrop`) the
                // workbench split overlay claims the gesture and swallows it.
                disableDrag={!reorderableLists}
                {...(reorderableLists ? { onItemDrop: handleListReorder } : {})}
                data-testid={`${testIdPrefix}-list`}
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
                title={`${words.valuesTitle} - ${selected.name}`}
                collapsible={false}
                minSize={80}
                data-testid={`${testIdPrefix}-entries-pane`}
                headerActions={disabled ? undefined : (
                  <HeaderHoverTooltip label={words.addEntry}>
                    <Button
                      secondary
                      small
                      icon="add"
                      options={{ ariaLabel: words.addEntry }}
                      onClick={handleAddEntry}
                      data-testid={`${testIdPrefix}-add-entry-button`}
                    />
                  </HeaderHoverTooltip>
                )}
              >
                <div style={{ padding: 8, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                  {renderSelectedListExtra?.(selected.id)}
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
                    keyHeader={words.keyHeader}
                    valueHeader={words.valueHeader}
                    showDescription={false}
                    showEnabledToggle={showEnabledToggle}
                    showValue={showValue}
                    disabled={disabled}
                    persistenceId={entriesPersistenceId}
                    data-testid={`${testIdPrefix}-entries-table`}
                  />
                </div>
              </Pane>
            ) : (
              <Pane title={words.valuesTitle} collapsible={false} minSize={80} data-testid={`${testIdPrefix}-entries-pane`}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--descriptionForeground)', fontStyle: 'italic', padding: 16 }}>
                  {/* The empty state carries a short explanation of the feature,
                      not just a prompt — cap the line length so the paragraph
                      stays readable when the pane is wide. */}
                  <span style={{ maxWidth: 520, textAlign: 'center', lineHeight: 1.5 }}>
                    {words.selectList}
                  </span>
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
