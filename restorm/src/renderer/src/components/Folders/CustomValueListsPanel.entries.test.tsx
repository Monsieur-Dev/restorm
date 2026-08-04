import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'

// The entries of a custom value list are edited through the shared key/value
// table, which hands back the rows IN THE ORDER THE USER SEES THEM — a drag is
// just another emission. What this pins is that the panel writes that order
// through unchanged, on every path the table can emit: reorder, rename, toggle
// and delete. An order that only lives in the table's local state would look
// right on screen and be gone on reload.

interface RowLike { id?: string; key: string; value: string; enabled?: boolean }

type Listener = (payload: unknown) => void
const emitted: { event: string; payload: unknown }[] = []

/** The props of the last rendered entries table, so a test can drive it. */
let tableProps: { initialRows?: RowLike[]; onRowsChange?: (rows: RowLike[]) => void } | null = null

/** The props of the lists tree, so a test can read what the panel declared. */
let listViewProps: { disableDrag?: boolean } | null = null

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key })
}))

vi.mock('electron-core-ui/renderer', () => {
  const passthrough = ({ children }: { children?: ReactNode }): ReactNode => createElement('div', {}, children)
  const KeyValueTable = (props: {
    initialRows?: RowLike[]
    onRowsChange?: (rows: RowLike[]) => void
  }): ReactNode => {
    tableProps = props
    return createElement('div', { 'data-testid': 'entries-table' })
  }
  return {
    __esModule: true,
    ListView: (props: { disableDrag?: boolean }): ReactNode => {
      listViewProps = props
      return null
    },
    VerticalSashContainer: (props: { Left?: ReactNode; Right?: ReactNode }): ReactNode =>
      createElement('div', {}, props.Left, props.Right),
    SplitView: passthrough,
    Pane: (props: { headerActions?: ReactNode; children?: ReactNode }): ReactNode =>
      createElement('div', {}, props.headerActions, props.children),
    Button: () => null,
    KeyValueTable,
    eventBus: {
      subscribe: (_event: string, _cb: Listener) => ({ unsubscribe: (): void => { /* no subscription under test */ } }),
      emitLocalSync: (event: string, payload: unknown): void => { emitted.push({ event, payload }) }
    }
  }
})

vi.mock('../MainView/HeaderHoverTooltip', () => ({
  HeaderHoverTooltip: ({ children }: { children?: ReactNode }): ReactNode => createElement('span', {}, children)
}))

import { CustomValueListsPanel } from './CustomValueListsPanel'
import { DocumentEvents } from '../../services/DocumentEvents'
import type { EnvironmentFolder } from '../../../../shared/types/collections'

const updateFolderCustomValueLists = vi.fn<(id: string, lists: unknown[]) => Promise<void>>()

function makeFolder(): EnvironmentFolder {
  return {
    id: 'env-1',
    name: 'Paint API',
    customValueLists: [
      {
        id: 'cvl-1',
        name: 'Couleur',
        entries: [
          { id: 'e-red', label: 'Rouge', value: 'FF0000' },
          { id: 'e-green', label: 'Vert', value: '00FF00' },
          { id: 'e-blue', label: 'Bleu', value: '0000FF' }
        ]
      }
    ]
  } as unknown as EnvironmentFolder
}

beforeEach(() => {
  emitted.length = 0
  tableProps = null
  listViewProps = null
  updateFolderCustomValueLists.mockReset()
  updateFolderCustomValueLists.mockResolvedValue(undefined)
  ;(window as unknown as { restorm: unknown }).restorm = {
    apiUpdate: { updateFolderCustomValueLists }
  }
})

afterEach(() => { cleanup() })

/** The table's props, failing the test rather than returning null. */
function table(): { initialRows?: RowLike[]; onRowsChange?: (rows: RowLike[]) => void } {
  if (!tableProps) throw new Error('expected the entries table to be rendered')
  return tableProps
}

/** Emit rows from the table the way a user gesture would. */
function emitRows(rows: RowLike[]): void {
  const onRowsChange = table().onRowsChange
  if (!onRowsChange) throw new Error('expected the entries table to be wired for persistence')
  act(() => { onRowsChange(rows) })
}

/** The entries the panel last handed to the main process, as label→value. */
function persistedEntries(): { label: string; value: string; enabled?: boolean }[] {
  const calls = updateFolderCustomValueLists.mock.calls
  const call = calls[calls.length - 1]
  if (!call) throw new Error('expected the panel to have pushed the lists to the main process')
  const lists = call[1] as { id: string; entries: { label: string; value: string; enabled?: boolean }[] }[]
  const list = lists.find((l) => l.id === 'cvl-1')
  if (!list) throw new Error('expected the edited list in the pushed payload')
  return list.entries
}

function renderPanel(folder: EnvironmentFolder, onFolderChange?: (f: EnvironmentFolder) => void): void {
  render(createElement(CustomValueListsPanel, {
    folder,
    ...(onFolderChange ? { onFolderChange } : {})
  }))
}

describe('CustomValueListsPanel — the lists tree refuses drags', () => {
  // Scope on purpose: this pins the DECLARATION, which is what can regress in
  // this file. What `disableDrag` then does — rows not draggable, and a
  // `dragstart` stamping nothing, so no surrounding drop target can claim the
  // gesture — is pinned one layer down against the real component, in
  // `electron-core-ui/src/renderer/components/ListView/ListView.test.tsx`.
  // Asserting it here would mean asserting against this file's own ListView
  // stub, which cannot fail for the reason it claims to guard. Don't "improve"
  // it into that.
  it('declares the lists tree with drags disabled', () => {
    renderPanel(makeFolder())
    if (!listViewProps) throw new Error('expected the lists tree to be rendered')
    expect(listViewProps.disableDrag).toBe(true)
  })
})

describe('CustomValueListsPanel — the entries table owns the order', () => {
  it('exposes the stored entries to the table in their stored order', () => {
    renderPanel(makeFolder())
    expect(table().initialRows?.map((r) => r.key)).toEqual(['Rouge', 'Vert', 'Bleu'])
  })

  it('persists a reordering, both onto the folder and out to the main process', () => {
    const folder = makeFolder()
    const onFolderChange = vi.fn()
    renderPanel(folder, onFolderChange)

    // Deliberately NOT alphabetical: an implementation that sorted the rows
    // instead of trusting their order would pass against a sorted expectation.
    emitRows([
      { id: 'e-green', key: 'Vert', value: '00FF00', enabled: true },
      { id: 'e-blue', key: 'Bleu', value: '0000FF', enabled: true },
      { id: 'e-red', key: 'Rouge', value: 'FF0000', enabled: true }
    ])

    // The folder the tree holds — this is what a save writes out.
    expect(folder.customValueLists?.[0]?.entries.map((e) => e.label)).toEqual(['Vert', 'Bleu', 'Rouge'])
    // The main-side store, which is what a dispatch resolves against.
    expect(persistedEntries().map((e) => e.label)).toEqual(['Vert', 'Bleu', 'Rouge'])
    // And the owner, so an unsaved-changes marker can notice.
    const lastFolder = onFolderChange.mock.calls[onFolderChange.mock.calls.length - 1]?.[0] as EnvironmentFolder | undefined
    expect(lastFolder?.customValueLists?.[0]?.entries.map((e) => e.label)).toEqual(['Vert', 'Bleu', 'Rouge'])
  })

  it('announces the change so an open request can re-read the list', () => {
    renderPanel(makeFolder())
    emitRows([
      { id: 'e-green', key: 'Vert', value: '00FF00', enabled: true },
      { id: 'e-blue', key: 'Bleu', value: '0000FF', enabled: true },
      { id: 'e-red', key: 'Rouge', value: 'FF0000', enabled: true }
    ])
    expect(emitted.some((e) => e.event === DocumentEvents.FOLDER_UPDATED)).toBe(true)
  })

  it('comes back in the new order on a fresh mount — the order is stored, not just displayed', () => {
    const folder = makeFolder()
    renderPanel(folder)
    emitRows([
      { id: 'e-green', key: 'Vert', value: '00FF00', enabled: true },
      { id: 'e-blue', key: 'Bleu', value: '0000FF', enabled: true },
      { id: 'e-red', key: 'Rouge', value: 'FF0000', enabled: true }
    ])
    cleanup()
    tableProps = null

    // Re-open the tab against the same (mutated) folder, as a reload would.
    renderPanel(folder)
    expect(table().initialRows?.map((r) => r.key)).toEqual(['Vert', 'Bleu', 'Rouge'])
  })

  it('still carries an edit, a disable and a deletion through the same path', () => {
    const folder = makeFolder()
    renderPanel(folder)

    emitRows([
      { id: 'e-red', key: 'Rouge foncé', value: '8B0000', enabled: true },
      { id: 'e-green', key: 'Vert', value: '00FF00', enabled: false }
    ])

    const entries = persistedEntries()
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ label: 'Rouge foncé', value: '8B0000', enabled: true })
    expect(entries[1]).toMatchObject({ label: 'Vert', enabled: false })
    // 'Bleu' was dropped by the table; the panel must not resurrect it.
    expect(entries.some((e) => e.label === 'Bleu')).toBe(false)
  })

  it('stores an EMPTY list when the last entry is deleted, not a blank one', () => {
    const folder = makeFolder()
    renderPanel(folder)

    // Deleting the last row empties the table, which immediately seeds one
    // blank row to type into and reports it. That row must not become an
    // entry: it would survive to disk and show up as an unpickable blank
    // line in every menu bound to the list.
    emitRows([])
    emitRows([{ id: 'seeded-blank', key: '', value: '', enabled: true }])

    expect(persistedEntries()).toEqual([])
    expect(folder.customValueLists?.[0]?.entries).toEqual([])
  })

  it('settles instead of looping when the table keeps re-seeding a blank row', () => {
    renderPanel(makeFolder())
    emitRows([])
    const afterEmptying = updateFolderCustomValueLists.mock.calls.length

    // Each re-seed carries a FRESH row id — the table mints one every time it
    // is handed an empty list. Writing on each of those would hand back an
    // empty list again and never converge, so a write that changes nothing
    // must not be a write at all.
    emitRows([{ id: 'seeded-blank-1', key: '', value: '', enabled: true }])
    emitRows([{ id: 'seeded-blank-2', key: '', value: '', enabled: true }])

    expect(updateFolderCustomValueLists.mock.calls.length).toBe(afterEmptying)
  })

  it('leaves a blank row alone while other rows have content — the user is mid-edit', () => {
    renderPanel(makeFolder())
    emitRows([
      { id: 'e-red', key: 'Rouge', value: 'FF0000', enabled: true },
      { id: 'fresh', key: '', value: '', enabled: true }
    ])
    expect(persistedEntries().map((e) => e.label)).toEqual(['Rouge', ''])
  })

  it('gives an id to a row the table created without one', () => {
    renderPanel(makeFolder())
    emitRows([
      { id: 'e-red', key: 'Rouge', value: 'FF0000', enabled: true },
      { key: 'Jaune', value: 'FFFF00', enabled: true }
    ])
    const entries = persistedEntries()
    const created = entries[entries.length - 1] as { id?: string } | undefined
    expect(created?.id).toBeTruthy()
  })
})
