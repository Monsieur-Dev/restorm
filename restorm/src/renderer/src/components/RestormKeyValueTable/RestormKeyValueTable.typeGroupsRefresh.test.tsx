import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'

// Renaming a custom value list must reach the type-pick menu of a request that
// is ALREADY OPEN. It did not: the groups were mirrored into a ref so the value
// cell renderer could stay stable, which kept the DATA fresh while nothing ever
// asked the cells to read it again — the menu went on showing the old name
// until the tab was closed and reopened. A ref cannot notify.
//
// What this pins is the notification, not the lookup: the value cell must be
// re-rendered with the CURRENT groups when they change, and must NOT be
// rebuilt when they don't (that churn is why the ref was introduced).

interface RowLike { id?: string; key?: string; value?: unknown }
interface GroupLike { id: string; name: string; customValueLists: { id: string; name: string }[]; enumDefinitions: unknown[] }

vi.mock('electron-core-ui/renderer', () => {
  const InputBox = (): ReactNode => createElement('input')
  const KeyValueTable = (props: {
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
            value: '',
            onChange: vi.fn(),
            ...(row.id !== undefined && { rowId: row.id })
          })
        )
      )
    )
  return { __esModule: true, InputBox, KeyValueTable, fieldDiffStyle: () => ({}) }
})

vi.mock('../RestormVariableInputBox', () => ({ RestormVariableInputBox: (): ReactNode => null }))

// Stand in for the real field: render the list NAMES the type menu would
// offer, and count MOUNTS (an empty-dep effect, not the render body — a
// re-render is expected and cheap; a remount is the churn the ref existed to
// prevent, and the thing that must not regress).
let mountCount = 0
vi.mock('../TypedValueField', async () => {
  const React = await import('react')
  return {
    TypedValueField: (props: { valueTypeGroups?: GroupLike[] }): ReactNode => {
      React.useEffect(() => { mountCount += 1 }, [])
      // Folder label AND list names — both are what the menu shows, so both
      // must be observable or an assertion on one of them proves nothing.
      const labels = (props.valueTypeGroups ?? [])
        .map((g) => `${g.name}>${g.customValueLists.map((l) => l.name).join(',')}`)
        .join(';')
      return createElement('div', { 'data-testid': 'menu-labels' }, labels)
    }
  }
})

// The hook the component reads; the test swaps what it returns to stand for a
// rename landing in the store.
let groups: GroupLike[] = []
vi.mock('../../hooks/useAllEnvValueTypeGroups', () => ({
  useAllEnvValueTypeGroups: () => groups
}))

import { RestormKeyValueTable } from './RestormKeyValueTable'
import { StringValue } from '../../../../shared/types/collections'

afterEach(() => {
  cleanup()
  mountCount = 0
})

function makeGroups(listName: string): GroupLike[] {
  return [{ id: 'env-1', name: 'Swagger Petstore', customValueLists: [{ id: 'cvl-1', name: listName }], enumDefinitions: [] }]
}

function renderTable(): ReturnType<typeof render> {
  return render(
    createElement(RestormKeyValueTable, {
      variables: [],
      initialRows: [{ id: 'r1', key: 'petId', value: new StringValue('2'), enabled: true }],
      'data-testid': 'params'
    })
  )
}

describe('RestormKeyValueTable — a renamed value list reaches an open request', () => {
  it('re-renders the value cell with the new name when a list is renamed', () => {
    groups = makeGroups('Pets')
    const { container, rerender } = renderTable()
    expect(container.querySelector('[data-testid="menu-labels"]')?.textContent).toBe('Swagger Petstore>Pets')

    // The rename lands in the store: the hook now returns a new array whose
    // content differs. Before the fix the cell kept the old array and this
    // assertion read "Pets".
    groups = makeGroups('Modified')
    rerender(
      createElement(RestormKeyValueTable, {
        variables: [],
        initialRows: [{ id: 'r1', key: 'petId', value: new StringValue('2'), enabled: true }],
        'data-testid': 'params'
      })
    )

    expect(container.querySelector('[data-testid="menu-labels"]')?.textContent).toBe('Swagger Petstore>Modified')
  })

  it('picks up a renamed environment folder too — the submenu label', () => {
    groups = [{ id: 'env-1', name: 'Swagger Petstore', customValueLists: [{ id: 'cvl-1', name: 'Pets' }], enumDefinitions: [] }]
    const { container, rerender } = renderTable()
    expect(container.querySelector('[data-testid="menu-labels"]')?.textContent).toBe('Swagger Petstore>Pets')

    groups = [{ id: 'env-1', name: 'Petstore renamed', customValueLists: [{ id: 'cvl-1', name: 'Pets' }], enumDefinitions: [] }]
    rerender(
      createElement(RestormKeyValueTable, {
        variables: [],
        initialRows: [{ id: 'r1', key: 'petId', value: new StringValue('2'), enabled: true }],
        'data-testid': 'params'
      })
    )
    // The submenu label itself must move, not just the entries under it.
    expect(container.querySelector('[data-testid="menu-labels"]')?.textContent).toBe('Petstore renamed>Pets')
  })

  it('does not rebuild the value cell when the groups are unchanged', () => {
    groups = makeGroups('Pets')
    const { rerender } = renderTable()
    const afterFirst = mountCount

    // Same array identity — the memoised hook returns it untouched when the
    // tree has not moved. The cell must not be rebuilt for this.
    rerender(
      createElement(RestormKeyValueTable, {
        variables: [],
        initialRows: [{ id: 'r1', key: 'petId', value: new StringValue('2'), enabled: true }],
        'data-testid': 'params'
      })
    )

    expect(mountCount).toBe(afterFirst)
  })
})
