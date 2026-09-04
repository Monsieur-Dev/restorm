/**
 * The stateful store (TASK-468.16): a POST really adds, GET lists/reads,
 * PUT edits, DELETE removes, the seed is the named examples, the
 * identifier is minted by strategy (never colliding), and a relation's
 * `onDelete` (cascade / restrict / setNull) is honoured on parent delete.
 */

import { describe, it, expect } from 'vitest'
import { DesignStatefulStore, identifierName } from '../../src/shared/design/designStateful'
import { buildReferenceApiDesign } from './apiDesignReference'
import type { ApiDesign, DesignModel } from '../../src/shared/types/apiDesign'

function model(design: ApiDesign, name: string): DesignModel {
  const found = design.models.find((m) => m.doc.name === name)
  if (found === undefined) throw new Error(`no model ${name}`)
  return found
}

describe('DesignStatefulStore', () => {
  it('seeds each collection from the named examples', () => {
    const design = buildReferenceApiDesign()
    const store = new DesignStatefulStore(design)
    const users = store.list(model(design, 'User'), {})
    // The reference design ships one named User example.
    expect(users.total).toBe(1)
    expect(users.items[0]?.['email']).toBe('admin@example.com')
  })

  it('POST adds, the next GET lists it, GET-by-id reads it', () => {
    const design = buildReferenceApiDesign()
    const store = new DesignStatefulStore(design)
    const User = model(design, 'User')
    const seededId = String(store.list(User, {}).items[0]?.['id'])
    const created = store.create(User, { email: 'new@example.com' })
    expect(created['email']).toBe('new@example.com')
    const key = identifierName(User)
    expect(key).toBe('id')
    const createdId = String(created[key ?? 'id'])
    // A distinct, non-empty identifier was assigned (server-owned).
    expect(createdId).not.toBe('')
    expect(createdId).not.toBe(seededId)
    expect(store.list(User, {}).total).toBe(2)
    expect(store.get(User, createdId)?.['email']).toBe('new@example.com')
  })

  it('mints the identifier by the model strategy, overriding the seed', () => {
    const design = buildReferenceApiDesign()
    const store = new DesignStatefulStore(design)
    const User = model(design, 'User') // identifier strategy: uuid
    const Order = model(design, 'Order') // identifier strategy: autoIncrement
    const user = store.create(User, { email: 'u@example.com' })
    // uuid strategy → a generated string token, never the seeded RNG value.
    expect(typeof user['id']).toBe('string')
    expect(String(user['id'])).toMatch(/^generated-user-/)
    const order = store.create(Order, { customer: String(user['id']) })
    // autoIncrement strategy → an integer.
    expect(typeof order['id']).toBe('number')
  })

  it('never mints a colliding identifier across many creates', () => {
    const design = buildReferenceApiDesign()
    const store = new DesignStatefulStore(design)
    const Order = model(design, 'Order') // autoIncrement — the collision-prone case
    const ids = new Set<string>()
    const seededIds = store.list(Order, {}).items.map((r) => String(r['id']))
    seededIds.forEach((id) => ids.add(id))
    for (let i = 0; i < 200; i++) {
      const created = store.create(Order, { customer: 'x' })
      ids.add(String(created['id']))
    }
    // Every seeded + created id is distinct (no strategy-less RNG collision).
    expect(ids.size).toBe(seededIds.length + 200)
  })

  it('PUT edits an existing row, DELETE removes it', () => {
    const design = buildReferenceApiDesign()
    const store = new DesignStatefulStore(design)
    const User = model(design, 'User')
    const created = store.create(User, { email: 'edit@example.com' })
    const id = String(created['id'])
    const updated = store.update(User, id, { email: 'edited@example.com' })
    expect(updated?.['email']).toBe('edited@example.com')
    // The identifier is not overwritten by the body.
    expect(String(updated?.['id'])).toBe(id)
    expect(store.remove(User, id)).toBe('removed')
    expect(store.get(User, id)).toBeUndefined()
    expect(store.remove(User, id)).toBe('not-found')
  })

  it('retarget swaps the design shape but keeps the accumulated rows (a live edit does not reset)', () => {
    const design = buildReferenceApiDesign()
    const store = new DesignStatefulStore(design)
    const User = model(design, 'User')
    store.create(User, { email: 'kept@example.com' })
    expect(store.list(User, {}).total).toBe(2) // seed + created
    // A live design edit while serving retargets the shape; the store is
    // ephemeral but resets only on restart, never on an edit.
    store.retarget(buildReferenceApiDesign())
    expect(store.list(User, {}).total).toBe(2)
  })

  it('does not take readOnly properties from the body', () => {
    const design = buildReferenceApiDesign()
    const store = new DesignStatefulStore(design)
    const User = model(design, 'User')
    // `id` is readOnly — a client-supplied id is ignored, a fresh one minted.
    const created = store.create(User, { id: 'client-forced', email: 'x@example.com' })
    expect(created['id']).not.toBe('client-forced')
  })

  it('cascade-deletes children referencing the removed parent', () => {
    const design = buildReferenceApiDesign()
    const User = model(design, 'User')
    const Order = model(design, 'Order')
    // Point Order.customer (a scalar FK) at User with a cascade rule.
    const orderModel = design.models.find((m) => m.id === Order.id)
    const customerProp = orderModel?.properties.find((p) => p.doc.name === 'customer')
    if (customerProp?.design?.reference !== undefined) customerProp.design.reference.onDelete = 'cascade'
    const store = new DesignStatefulStore(design)
    const parent = store.create(User, { email: 'p2@example.com' })
    const pid = String(parent['id'])
    store.create(Order, { customer: pid })
    expect(store.list(Order, {}).items.some((row) => String(row['customer']) === pid)).toBe(true)
    expect(store.remove(User, pid)).toBe('removed')
    expect(store.list(Order, {}).items.some((row) => String(row['customer']) === pid)).toBe(false)
  })

  it('refuses to delete a parent a restrict relation still references (409 upstream)', () => {
    const design = buildReferenceApiDesign()
    const User = model(design, 'User')
    const Order = model(design, 'Order') // Order.customer → User, onDelete: restrict (default)
    const store = new DesignStatefulStore(design)
    const parent = store.create(User, { email: 'kept@example.com' })
    const pid = String(parent['id'])
    store.create(Order, { customer: pid })
    expect(store.remove(User, pid)).toBe('restricted')
    // The parent is still there (the delete was vetoed).
    expect(store.get(User, pid)?.['email']).toBe('kept@example.com')
  })

  it('nulls the referencing field on a setNull relation', () => {
    const design = buildReferenceApiDesign()
    const User = model(design, 'User')
    const Order = model(design, 'Order')
    const orderModel = design.models.find((m) => m.id === Order.id)
    const customerProp = orderModel?.properties.find((p) => p.doc.name === 'customer')
    if (customerProp?.design?.reference !== undefined) customerProp.design.reference.onDelete = 'setNull'
    const store = new DesignStatefulStore(design)
    const parent = store.create(User, { email: 'sn@example.com' })
    const pid = String(parent['id'])
    const order = store.create(Order, { customer: pid })
    const orderId = String(order['id'])
    expect(store.remove(User, pid)).toBe('removed')
    expect(store.get(Order, orderId)?.['customer']).toBeNull()
  })
})
