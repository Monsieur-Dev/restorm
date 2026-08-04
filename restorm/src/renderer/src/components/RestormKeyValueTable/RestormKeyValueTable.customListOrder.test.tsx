import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { createElement, memo, type ReactNode } from 'react'

// Reordering the values of a custom value list must reach the value picker of a
// request that is ALREADY OPEN — no closing and reopening the tab.
//
// The assertion is deliberately on what the CONSUMER RENDERS: the `<option>`
// sequence of the picker, read out of the DOM. Asserting that the store now
// holds the new order would prove nothing about the screen — the whole class of
// bug here is data that is fresh while nothing asks the view to look again.
//
// The chain under test is the real one: the folder is mutated IN PLACE (as the
// custom-values panel does), a FOLDER_UPDATED is emitted, and everything from
// `useAllEnvValueTypeGroups` down through the value cell to the picker is the
// production code.

interface RowLike { id?: string; key?: string; value?: unknown }

type Listener = (payload: unknown) => void
const listeners = new Map<string, Set<Listener>>()
/** Stable no-op: a fresh `vi.fn()` per render would defeat the memoised table. */
const noop = (): void => { /* the cell's edits are not what this test observes */ }

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key })
}))

// ECUI resolves to its built dist in vitest, whose CSS side-imports don't
// resolve, so the module is stubbed. Two stubs carry the test: `KeyValueTable`
// renders the value cell for each row (standing in for the real table), and
// `SelectBox` renders REAL <option> elements so the ORDER is observable in the
// DOM rather than taken on trust from a prop.
vi.mock('electron-core-ui/renderer', () => {
  const passthrough = ({ children }: { children?: ReactNode }): ReactNode => createElement('div', {}, children)
  const InputBox = (): ReactNode => createElement('input')
  const Button = (): ReactNode => createElement('button', { type: 'button' })
  const SelectBox = (props: {
    options?: { text: string }[]
    selected?: number
    'data-testid'?: string
  }): ReactNode =>
    createElement(
      'select',
      {
        ...(props['data-testid'] ? { 'data-testid': props['data-testid'] } : {}),
        'data-selected-index': String(props.selected ?? 0)
      },
      (props.options ?? []).map((o, i) => createElement('option', { key: i }, o.text))
    )
  // MEMOISED on purpose, like the real table. The whole point of the test is
  // that the picker is refreshed by a NOTIFICATION — a new cell renderer coming
  // down — and not by the row happening to re-render for some other reason. A
  // plain function component would re-render whenever its parent did and would
  // therefore pass even with a stale-by-construction cell renderer.
  const KeyValueTableInner = (props: {
    initialRows?: RowLike[]
    renderValueCell?: (p: { value: string; onChange: (v: string) => void; rowId?: string }) => ReactNode
  }): ReactNode =>
    createElement(
      'div',
      {},
      (props.initialRows ?? []).map((row, i) =>
        createElement(
          'div',
          { key: row.id ?? String(i) },
          props.renderValueCell?.({
            value: typeof row.value === 'string' ? row.value : '',
            onChange: noop,
            ...(row.id !== undefined && { rowId: row.id })
          })
        )
      )
    )
  KeyValueTableInner.displayName = 'KeyValueTable'
  const KeyValueTable = memo(KeyValueTableInner)
  const eventBus = {
    subscribe: (event: string, cb: Listener) => {
      const set = listeners.get(event) ?? new Set<Listener>()
      set.add(cb)
      listeners.set(event, set)
      return { unsubscribe: (): void => { set.delete(cb) } }
    },
    emitLocalSync: (event: string, payload: unknown): void => {
      listeners.get(event)?.forEach((cb) => { cb(payload) })
    }
  }
  return {
    __esModule: true,
    Button,
    InputBox,
    SelectBox,
    ContextMenu: () => null,
    Modal: () => null,
    ControlGroup: passthrough,
    Tooltip: () => null,
    ColorPicker: () => null,
    DateTimePicker: () => null,
    Toggle: () => null,
    MultiSelectCombo: () => null,
    KeyValueTable,
    fieldDiffStyle: () => ({}),
    eventBus
  }
})

vi.mock('../RestormVariableInputBox', () => ({ RestormVariableInputBox: (): ReactNode => null }))

// The store the type-group hook reads. The FOLDER object and the collections
// array are stable — they are the reactive tree, and the panel edits a folder in
// place — so nothing but the FOLDER_UPDATED event can drive the refresh.
interface EntryFixture { id: string; label: string; value: string; enabled?: boolean }
const initialEntries = (): EntryFixture[] => ([
  { id: 'e-red', label: 'Rouge', value: 'FF0000' },
  { id: 'e-green', label: 'Vert', value: '00FF00' },
  { id: 'e-blue', label: 'Bleu', value: '0000FF' }
])
const folder = {
  id: 'env-1',
  name: 'Paint API',
  folderType: 'environment' as const,
  items: [],
  customValueLists: [{ id: 'cvl-1', name: 'Couleur', entries: initialEntries() }],
  enumDefinitions: []
}
const collections = [folder]

vi.mock('../../store/restormStore', () => ({
  useRestormStore: (selector: (s: { collections: unknown[] }) => unknown) => selector({ collections })
}))

import { RestormKeyValueTable } from './RestormKeyValueTable'
import { CustomListValue } from '../../../../shared/types/collections'
import { DocumentEvents } from '../../services/DocumentEvents'
import { eventBus } from 'electron-core-ui/renderer'

beforeAll(() => {
  ;(window as unknown as { restorm: unknown }).restorm = {
    secrets: {
      invalidate: () => Promise.resolve({ success: true }),
      resolve: () => Promise.resolve({ value: '' })
    }
  }
})

afterEach(() => {
  cleanup()
  listeners.clear()
  folder.customValueLists = [{ id: 'cvl-1', name: 'Couleur', entries: initialEntries() }]
})

/** The labels the picker currently offers, in the order it renders them. */
function pickerOptions(container: HTMLElement): string[] {
  const select = container.querySelector('select')
  if (!select) throw new Error('expected the custom-list picker to be rendered')
  return Array.from(select.querySelectorAll('option')).map((o) => o.textContent)
}

function renderOpenRequest(): ReturnType<typeof render> {
  return render(
    createElement(RestormKeyValueTable, {
      variables: [],
      initialRows: [{ id: 'r1', key: 'color', value: new CustomListValue('cvl-1', 'Vert'), enabled: true }],
      'data-testid': 'params'
    })
  )
}

/**
 * Reorder the list's entries the way the panel does: the FOLDER object stays
 * the same (it is a reactive proxy living in the tree) but its lists are
 * REPLACED with fresh objects, then a FOLDER_UPDATED is emitted. Replacing
 * rather than mutating the list is what makes this test honest — a consumer
 * holding a stale group would otherwise read the new order straight out of the
 * object it already had, and the test would pass without any notification.
 */
function reorderEntriesTo(order: string[]): void {
  const list = folder.customValueLists[0]
  if (!list) throw new Error('fixture list missing')
  const byId = new Map(list.entries.map((e) => [e.id, e]))
  const entries = order.map((id) => {
    const entry = byId.get(id)
    if (!entry) throw new Error(`unknown entry ${id}`)
    return { ...entry }
  })
  folder.customValueLists = [{ ...list, entries }]
  act(() => {
    eventBus.emitLocalSync(DocumentEvents.FOLDER_UPDATED, {
      type: 'folder',
      id: folder.id,
      document: folder
    })
  })
}

describe('a reordered value list reaches the picker of an open request', () => {
  it('re-renders the picker in the new order without remounting the tab', () => {
    const { container } = renderOpenRequest()
    expect(pickerOptions(container)).toEqual(['Rouge', 'Vert', 'Bleu'])

    reorderEntriesTo(['e-blue', 'e-green', 'e-red'])

    expect(pickerOptions(container)).toEqual(['Bleu', 'Vert', 'Rouge'])
  })

  it('keeps the row pointed at the value the user picked, at its new position', () => {
    const { container } = renderOpenRequest()
    // 'Vert' starts second.
    expect(container.querySelector('select')?.getAttribute('data-selected-index')).toBe('1')

    // Move it last: the selection must follow the LABEL, not the old index —
    // an index-only follow would silently repoint the row at another value.
    reorderEntriesTo(['e-red', 'e-blue', 'e-green'])

    expect(pickerOptions(container)).toEqual(['Rouge', 'Bleu', 'Vert'])
    expect(container.querySelector('select')?.getAttribute('data-selected-index')).toBe('2')
  })

  it('offers no choice at all for a list whose only entry has no label', () => {
    const { container } = renderOpenRequest()
    // The shape the entries table produces for an emptied list: one blank row.
    // Rendering it as an option would put an invisible line in the menu that
    // silently selects nothing.
    folder.customValueLists = [{ id: 'cvl-1', name: 'Couleur', entries: [{ id: 'blank', label: '', value: '' }] }]
    act(() => {
      eventBus.emitLocalSync(DocumentEvents.FOLDER_UPDATED, { type: 'folder', id: folder.id, document: folder })
    })

    expect(pickerOptions(container)).toEqual([])
  })

  it('drops a disabled entry from the picker while keeping the rest in order', () => {
    const { container } = renderOpenRequest()
    const list = folder.customValueLists[0]
    if (!list) throw new Error('fixture list missing')
    const blue = list.entries.find((e) => e.id === 'e-blue')
    if (!blue) throw new Error('fixture entry missing')
    blue.enabled = false

    reorderEntriesTo(['e-blue', 'e-red', 'e-green'])

    expect(pickerOptions(container)).toEqual(['Rouge', 'Vert'])
  })
})
