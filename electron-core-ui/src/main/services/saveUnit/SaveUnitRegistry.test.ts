import { describe, it, expect, beforeEach } from 'vitest'
import { SaveUnitRegistry } from './SaveUnitRegistry'
import { isTombstone, isUnitDirty, isUnitNew } from './types'

interface Doc {
  name: string
  body?: string
}

function refOf(reg: SaveUnitRegistry, id: string): Doc | undefined {
  const unit = reg.get(id)
  return unit?.reference as Doc | undefined
}
function draftOf(reg: SaveUnitRegistry, id: string): unknown {
  return reg.get(id)?.draft
}

describe('SaveUnitRegistry', () => {
  let reg: SaveUnitRegistry

  beforeEach(() => {
    reg = new SaveUnitRegistry()
  })

  describe('hydrate', () => {
    it('registers a clean unit with only a reference', () => {
      reg.hydrate({ runtimeId: 'a', kind: 'file', reference: { name: 'foo' } satisfies Doc })
      const unit = reg.get('a')
      expect(unit?.reference).toEqual({ name: 'foo' })
      expect(unit?.draft).toBeUndefined()
      expect(reg.isDirty('a')).toBe(false)
      expect(reg.isGlobalDirty()).toBe(false)
    })

    it('supports a parentId', () => {
      reg.hydrate({ runtimeId: 'parent', kind: 'folder', reference: {} })
      reg.hydrate({ runtimeId: 'child', kind: 'file', reference: {}, parentId: 'parent' })
      expect(reg.get('child')?.parentId).toBe('parent')
    })
  })

  describe('create', () => {
    it('makes a new unit dirty from the start with reason=create', () => {
      reg.create({ runtimeId: 'new', kind: 'file', draft: { name: 'x' } satisfies Doc })
      const unit = reg.get('new')
      expect(unit).toBeDefined()
      if (!unit) return
      expect(unit.reference).toBeUndefined()
      expect(unit.draft).toEqual({ name: 'x' })
      expect(unit.lastDirtyReason).toBe('create')
      expect(isUnitNew(unit)).toBe(true)
    })

    it('throws on duplicate runtimeId', () => {
      reg.create({ runtimeId: 'new', kind: 'file', draft: { name: 'x' } satisfies Doc })
      expect(() => { reg.create({ runtimeId: 'new', kind: 'file', draft: { name: 'y' } satisfies Doc }) }).toThrow()
    })
  })

  describe('mutate', () => {
    beforeEach(() => {
      reg.hydrate({ runtimeId: 'a', kind: 'file', reference: { name: 'original' } satisfies Doc })
    })

    it('stores a draft and marks dirty', () => {
      reg.mutate('a', { name: 'changed' } satisfies Doc)
      expect(draftOf(reg, 'a')).toEqual({ name: 'changed' })
      expect(reg.isDirty('a')).toBe(true)
    })

    it('discards the draft when mutated back to reference shape (undo)', () => {
      reg.mutate('a', { name: 'changed' } satisfies Doc)
      expect(reg.isDirty('a')).toBe(true)
      reg.mutate('a', { name: 'original' } satisfies Doc)
      expect(reg.isDirty('a')).toBe(false)
      expect(draftOf(reg, 'a')).toBeUndefined()
    })

    it('deep-compares objects and arrays', () => {
      reg.hydrate({ runtimeId: 'b', kind: 'file', reference: { tags: ['a', 'b'] } })
      reg.mutate('b', { tags: ['a', 'b'] })
      expect(reg.isDirty('b')).toBe(false)
    })

    it('detects a revert across reordered keys via canonical JSON', () => {
      // hydrate path produces { name, body }, upsert path produces { body, name } —
      // sameShape's order-insensitive deep-equal catches this, but if a
      // future asymmetry (transient undefined fields, etc.) breaks
      // sameShape, the canonical-JSON fallback still recognises the
      // revert. Belt-and-braces: drive the comparison via a sibling
      // unit whose shape differs only in key order.
      reg.hydrate({ runtimeId: 'reorder', kind: 'file', reference: { name: 'r', body: 'B' } })
      // First mark dirty with a real change.
      reg.mutate('reorder', { name: 'r', body: 'B!' })
      expect(reg.isDirty('reorder')).toBe(true)
      // Revert with reversed key order — must still discard the draft.
      reg.mutate('reorder', { body: 'B', name: 'r' })
      expect(reg.isDirty('reorder')).toBe(false)
    })

    it('detects a revert when the upsert pipeline added a transient undefined field', () => {
      reg.hydrate({ runtimeId: 'u', kind: 'file', reference: { name: 'x' } satisfies Doc })
      reg.mutate('u', { name: 'x-edited' } satisfies Doc)
      expect(reg.isDirty('u')).toBe(true)
      // Revert payload carries an extra undefined-valued field — the
      // canonical-JSON fallback strips undefineds before comparing,
      // so this is recognised as identical to the reference.
      reg.mutate('u', { name: 'x', body: undefined } as unknown as Doc)
      expect(reg.isDirty('u')).toBe(false)
    })

    it('throws on unknown runtimeId', () => {
      expect(() => { reg.mutate('missing', { name: 'x' } satisfies Doc) }).toThrow()
    })

    it('accepts a custom reason (e.g. rename)', () => {
      reg.mutate('a', { name: 'renamed' } satisfies Doc, 'rename')
      expect(reg.get('a')?.lastDirtyReason).toBe('rename')
    })
  })

  describe('markDeleted', () => {
    it('stores a tombstone with a snapshot of the reference', () => {
      reg.hydrate({ runtimeId: 'a', kind: 'file', reference: { name: 'foo' } satisfies Doc })
      reg.markDeleted('a')
      const draft = draftOf(reg, 'a')
      expect(isTombstone(draft)).toBe(true)
      expect(reg.isDirty('a')).toBe(true)
    })

    it('is idempotent', () => {
      reg.hydrate({ runtimeId: 'a', kind: 'file', reference: { name: 'foo' } satisfies Doc })
      reg.markDeleted('a')
      const before = reg.get('a')
      reg.markDeleted('a')
      expect(reg.get('a')).toBe(before)
    })

    it('destroys a never-saved unit instead of tombstoning it', () => {
      reg.create({ runtimeId: 'fresh', kind: 'file', draft: { name: 'new' } satisfies Doc })
      reg.markDeleted('fresh')
      expect(reg.has('fresh')).toBe(false)
    })
  })

  describe('move', () => {
    it('updates parentId and creates a draft if clean', () => {
      reg.hydrate({ runtimeId: 'a', kind: 'file', reference: { name: 'x' } satisfies Doc, parentId: 'p1' })
      reg.move('a', 'p2')
      expect(reg.get('a')?.parentId).toBe('p2')
      expect(reg.isDirty('a')).toBe(true)
      expect(draftOf(reg, 'a')).toEqual({ name: 'x' })
      expect(reg.get('a')?.lastDirtyReason).toBe('move')
    })

    it('is a no-op when the parent is unchanged', () => {
      reg.hydrate({ runtimeId: 'a', kind: 'file', reference: { name: 'x' } satisfies Doc, parentId: 'p1' })
      reg.move('a', 'p1')
      expect(reg.isDirty('a')).toBe(false)
    })
  })

  describe('commit', () => {
    it('promotes draft to reference on a normal modify', () => {
      reg.hydrate({ runtimeId: 'a', kind: 'file', reference: { name: 'v1' } satisfies Doc })
      reg.mutate('a', { name: 'v2' } satisfies Doc)
      reg.commit('a')
      expect(refOf(reg, 'a')).toEqual({ name: 'v2' })
      expect(reg.isDirty('a')).toBe(false)
    })

    it('removes the unit when committing a tombstone', () => {
      reg.hydrate({ runtimeId: 'a', kind: 'file', reference: { name: 'v1' } satisfies Doc })
      reg.markDeleted('a')
      reg.commit('a')
      expect(reg.has('a')).toBe(false)
    })

    it('is a no-op on a clean unit', () => {
      reg.hydrate({ runtimeId: 'a', kind: 'file', reference: { name: 'v1' } satisfies Doc })
      reg.commit('a')
      expect(refOf(reg, 'a')).toEqual({ name: 'v1' })
    })
  })

  describe('commitIfDraftMatches', () => {
    it('commits and returns true when the draft matches the expected value', () => {
      reg.hydrate({ runtimeId: 'a', kind: 'file', reference: { name: 'v1' } satisfies Doc })
      reg.mutate('a', { name: 'v2' } satisfies Doc)
      const result = reg.commitIfDraftMatches('a', { name: 'v2' } satisfies Doc)
      expect(result).toBe(true)
      expect(refOf(reg, 'a')).toEqual({ name: 'v2' })
      expect(reg.isDirty('a')).toBe(false)
    })

    it('returns false and leaves the unit dirty when a newer draft has replaced the expected one', () => {
      reg.hydrate({ runtimeId: 'a', kind: 'file', reference: { name: 'v1' } satisfies Doc })
      reg.mutate('a', { name: 'v2' } satisfies Doc)
      // A later edit replaces the draft before the save completes.
      reg.mutate('a', { name: 'v3' } satisfies Doc)
      const result = reg.commitIfDraftMatches('a', { name: 'v2' } satisfies Doc)
      expect(result).toBe(false)
      expect(refOf(reg, 'a')).toEqual({ name: 'v1' })
      expect(reg.isDirty('a')).toBe(true)
    })

    it('returns false on an unknown runtimeId', () => {
      expect(reg.commitIfDraftMatches('missing', { name: 'v2' })).toBe(false)
    })

    it('returns false on a clean unit', () => {
      reg.hydrate({ runtimeId: 'a', kind: 'file', reference: { name: 'v1' } satisfies Doc })
      expect(reg.commitIfDraftMatches('a', { name: 'v1' })).toBe(false)
    })

    it('emits a clean event only when the commit proceeds', () => {
      reg.hydrate({ runtimeId: 'a', kind: 'file', reference: { name: 'v1' } satisfies Doc })
      reg.mutate('a', { name: 'v2' } satisfies Doc)
      reg.mutate('a', { name: 'v3' } satisfies Doc)
      const events: { isDirty: boolean }[] = []
      reg.onUnitChange((s) => { events.push({ isDirty: s.isDirty }) })
      const result = reg.commitIfDraftMatches('a', { name: 'v2' })
      expect(result).toBe(false)
      expect(events).toEqual([])
    })
  })

  describe('revert', () => {
    it('discards the draft, reference unchanged', () => {
      reg.hydrate({ runtimeId: 'a', kind: 'file', reference: { name: 'v1' } satisfies Doc })
      reg.mutate('a', { name: 'v2' } satisfies Doc)
      reg.revert('a')
      expect(reg.isDirty('a')).toBe(false)
      expect(refOf(reg, 'a')).toEqual({ name: 'v1' })
    })

    it('destroys a never-saved unit on revert', () => {
      reg.create({ runtimeId: 'fresh', kind: 'file', draft: { name: 'new' } satisfies Doc })
      reg.revert('fresh')
      expect(reg.has('fresh')).toBe(false)
    })
  })

  describe('list helpers', () => {
    beforeEach(() => {
      reg.hydrate({ runtimeId: 'clean', kind: 'file', reference: { name: 'c' } satisfies Doc })
      reg.hydrate({ runtimeId: 'dirty', kind: 'file', reference: { name: 'd' } satisfies Doc })
      reg.mutate('dirty', { name: 'd2' } satisfies Doc)
    })

    it('listDirty returns only dirty units', () => {
      const dirty = reg.listDirty()
      expect(dirty).toHaveLength(1)
      expect(dirty[0]?.runtimeId).toBe('dirty')
    })

    it('dirtyCount / isGlobalDirty track the registry state', () => {
      expect(reg.dirtyCount()).toBe(1)
      expect(reg.isGlobalDirty()).toBe(true)
      reg.revert('dirty')
      expect(reg.dirtyCount()).toBe(0)
      expect(reg.isGlobalDirty()).toBe(false)
    })
  })

  describe('events', () => {
    it('emits on create / mutate / revert / commit with the right payload', () => {
      const events: unknown[] = []
      reg.onUnitChange((snap) => { events.push({ ...snap }) })

      reg.create({ runtimeId: 'a', kind: 'file', draft: { name: 'x' } satisfies Doc })
      reg.commit('a')
      reg.mutate('a', { name: 'y' } satisfies Doc)
      reg.revert('a')

      expect(events).toEqual([
        { runtimeId: 'a', isDirty: true, reason: 'create' },
        { runtimeId: 'a', isDirty: false, reason: undefined },
        { runtimeId: 'a', isDirty: true, reason: 'modify' },
        { runtimeId: 'a', isDirty: false, reason: undefined }
      ])
    })

    it('onUnitChange returns an unsubscribe', () => {
      const events: unknown[] = []
      const off = reg.onUnitChange((snap) => { events.push({ ...snap }) })
      off()
      reg.create({ runtimeId: 'a', kind: 'file', draft: { name: 'x' } satisfies Doc })
      expect(events).toEqual([])
    })

    it('swallows listener errors', () => {
      reg.onUnitChange(() => { throw new Error('boom') })
      expect(() => { reg.create({ runtimeId: 'a', kind: 'file', draft: { name: 'x' } satisfies Doc }) }).not.toThrow()
    })
  })

  describe('reorder scenario', () => {
    it('records reason=reorder via mutate and emits once per sibling flipped', () => {
      reg.hydrate({ runtimeId: 'a', kind: 'file', reference: { name: 'a', counter: 1 } })
      reg.hydrate({ runtimeId: 'b', kind: 'file', reference: { name: 'b', counter: 2 } })
      reg.hydrate({ runtimeId: 'c', kind: 'file', reference: { name: 'c', counter: 3 } })

      const events: { id: string; reason: string | undefined; isDirty: boolean }[] = []
      reg.onUnitChange((s) => { events.push({ id: s.runtimeId, reason: s.reason, isDirty: s.isDirty }) })

      // Swap b and c — both siblings' counters flip, all three units
      // visually "reorder" but only the affected ones (b, c) are dirty.
      reg.mutate('b', { name: 'b', counter: 3 }, 'reorder')
      reg.mutate('c', { name: 'c', counter: 2 }, 'reorder')

      expect(events).toEqual([
        { id: 'b', reason: 'reorder', isDirty: true },
        { id: 'c', reason: 'reorder', isDirty: true }
      ])
      expect(reg.isDirty('a')).toBe(false)
      expect(reg.isDirty('b')).toBe(true)
      expect(reg.isDirty('c')).toBe(true)
    })

    it('undoing one of two reordered siblings only drops that one', () => {
      reg.hydrate({ runtimeId: 'b', kind: 'file', reference: { name: 'b', counter: 2 } })
      reg.hydrate({ runtimeId: 'c', kind: 'file', reference: { name: 'c', counter: 3 } })
      reg.mutate('b', { name: 'b', counter: 3 }, 'reorder')
      reg.mutate('c', { name: 'c', counter: 2 }, 'reorder')
      // User cancels one edit → draft equals reference → draft dropped.
      reg.mutate('b', { name: 'b', counter: 2 })
      expect(reg.isDirty('b')).toBe(false)
      expect(reg.isDirty('c')).toBe(true)
    })
  })

  describe('utility predicates', () => {
    it('isUnitDirty matches the registry helper', () => {
      reg.hydrate({ runtimeId: 'a', kind: 'file', reference: { name: 'x' } satisfies Doc })
      const unit = reg.get('a')
      expect(unit).toBeDefined()
      if (!unit) return
      expect(isUnitDirty(unit)).toBe(false)
      reg.mutate('a', { name: 'y' } satisfies Doc)
      const unit2 = reg.get('a')
      if (!unit2) return
      expect(isUnitDirty(unit2)).toBe(true)
    })
  })

  describe('markAllClean', () => {
    it('drops drafts and emits clean events for previously-dirty units only', () => {
      reg.hydrate({ runtimeId: 'a', kind: 'file', reference: { name: 'a' } satisfies Doc })
      reg.hydrate({ runtimeId: 'b', kind: 'file', reference: { name: 'b' } satisfies Doc })
      reg.hydrate({ runtimeId: 'c', kind: 'file', reference: { name: 'c' } satisfies Doc })

      reg.mutate('a', { name: 'a-edited' } satisfies Doc)
      reg.mutate('b', { name: 'b-edited' } satisfies Doc, 'rename')
      // c stays clean.

      const events: { id: string; isDirty: boolean }[] = []
      reg.onUnitChange((s) => { events.push({ id: s.runtimeId, isDirty: s.isDirty }) })

      reg.markAllClean()

      expect(reg.isDirty('a')).toBe(false)
      expect(reg.isDirty('b')).toBe(false)
      expect(reg.isDirty('c')).toBe(false)
      expect(draftOf(reg, 'a')).toBeUndefined()
      expect(draftOf(reg, 'b')).toBeUndefined()
      expect(reg.isGlobalDirty()).toBe(false)

      // Two clean transitions, no spurious event for c.
      expect(events).toEqual([
        { id: 'a', isDirty: false },
        { id: 'b', isDirty: false }
      ])
    })

    it('clears tombstones too (pending-delete becomes clean)', () => {
      reg.hydrate({ runtimeId: 'a', kind: 'file', reference: { name: 'a' } satisfies Doc })
      reg.markDeleted('a')
      expect(reg.isDirty('a')).toBe(true)

      reg.markAllClean()

      const unit = reg.get('a')
      expect(unit).toBeDefined()
      expect(unit?.draft).toBeUndefined()
      expect(reg.isDirty('a')).toBe(false)
    })

    it('is a no-op when nothing is dirty', () => {
      reg.hydrate({ runtimeId: 'a', kind: 'file', reference: { name: 'a' } satisfies Doc })
      const events: unknown[] = []
      reg.onUnitChange((s) => { events.push(s) })

      reg.markAllClean()

      expect(events).toEqual([])
      expect(reg.isDirty('a')).toBe(false)
    })
  })
})
