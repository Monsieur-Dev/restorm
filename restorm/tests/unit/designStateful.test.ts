/**
 * The stateful store (TASK-468.16): a POST really adds, GET lists/reads,
 * PUT edits, DELETE removes, the seed is the named examples, and a
 * cascade relation removes children on parent delete.
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
    expect(store.remove(User, id)).toBe(true)
    expect(store.get(User, id)).toBeUndefined()
    expect(store.remove(User, id)).toBe(false)
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
    const store = new DesignStatefulStore(design)
    const User = model(design, 'User')
    const Order = model(design, 'Order')
    // Order.customer references User with onDelete: restrict; add a
    // cascade relation to prove the mechanism (lines → User is cascade).
    const user = store.create(User, { email: 'parent@example.com' })
    const userId = String(user['id'])
    // The Order model's `lines` is an array-of-ref (not a scalar FK), so
    // for the cascade path we exercise the `customer` field by pointing
    // it at the created user then deleting the user with a cascade rule.
    const orderModel = design.models.find((m) => m.id === Order.id)
    const customerProp = orderModel?.properties.find((p) => p.doc.name === 'customer')
    if (customerProp?.design?.reference !== undefined) customerProp.design.reference.onDelete = 'cascade'
    const freshStore = new DesignStatefulStore(design)
    const parent = freshStore.create(User, { email: 'p2@example.com' })
    const pid = String(parent['id'])
    const order = freshStore.create(Order, { customer: pid })
    expect(freshStore.list(Order, {}).total).toBeGreaterThan(0)
    freshStore.remove(User, pid)
    expect(freshStore.list(Order, {}).items.some((row) => String(row['customer']) === pid)).toBe(false)
    void userId; void order
  })
})
