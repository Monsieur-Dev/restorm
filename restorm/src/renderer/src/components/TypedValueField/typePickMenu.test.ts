import { describe, it, expect } from 'vitest'
import { collectTypeLeaves, type TypeMenuNode } from './typePickMenu'

const noop = (): void => undefined

describe('collectTypeLeaves', () => {
  it('counts only selectable type leaves (skips separators + the remove action)', () => {
    const menu: TypeMenuNode[] = [
      { id: 'string', onClick: noop },
      { id: 'number', onClick: noop },
      { id: 'sep', isSeparator: true },
      { id: 'expression', onClick: noop },
      { id: 'sep-remove', isSeparator: true },
      { id: 'remove', onClick: noop }
    ]
    expect(collectTypeLeaves(menu).map((l) => l.id)).toEqual(['string', 'number', 'expression'])
  })

  it('recurses into API / Variables submenus', () => {
    const menu: TypeMenuNode[] = [
      { id: 'string', onClick: noop },
      { id: 'variables', items: [
        { id: 'variable-a', onClick: noop, checked: true },
        { id: 'variable-b', onClick: noop }
      ] }
    ]
    expect(collectTypeLeaves(menu)).toHaveLength(3)
  })

  it('a variable-only field with a single variable yields exactly one leaf (button hidden)', () => {
    const menu: TypeMenuNode[] = [
      { id: 'variables', items: [{ id: 'variable-only', onClick: noop }] }
    ]
    const leaves = collectTypeLeaves(menu)
    expect(leaves).toHaveLength(1)
    expect(leaves[0]?.id).toBe('variable-only')
  })

  it('an empty / all-excluded menu yields zero leaves', () => {
    expect(collectTypeLeaves([{ id: 'sep', isSeparator: true }])).toHaveLength(0)
  })
})
