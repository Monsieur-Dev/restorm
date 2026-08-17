/**
 * The stateful mode of the design server (TASK-468 mode B): an
 * EPHEMERAL in-memory store per served design. A POST really adds an
 * object, the next GET lists it, PUT/PATCH edits it, DELETE removes it,
 * and relations are honoured: deleting a row CASCADES to rows that
 * reference it with `onDelete: cascade`, NULLS the reference on
 * `setNull`, and is REFUSED (the caller answers 409) when a `restrict`
 * reference still points at it. The store SEEDS from the models' named
 * examples and resets whenever the server restarts (NOT on a live edit —
 * an edit while serving keeps the accumulated rows, {@link retarget}
 * only swaps the design shape used by future operations).
 *
 * Pure and deterministic — the main-side `DesignServerService` routes a
 * matched HTTP request here when `serving.stateful` is on; stateless
 * (468.6) stays the default and the hot forced-response steering keeps
 * priority over the state upstream of this module.
 */

import type { ApiDesign, DesignModel } from '../types/apiDesign'
import { buildModelInstance, servedProperties } from './designServing'

/** One served row (a plain JSON object). */
export type StatefulRow = Record<string, unknown>

/** The identifier PROPERTY of a model (its declared identifier, else a
 * property literally named `id`, else undefined). */
export function identifierProperty(model: DesignModel): DesignModel['properties'][number] | undefined {
  const declaredId = model.design?.identifier?.propertyId
  const declared = declaredId !== undefined
    ? model.properties.find((p) => p.id === declaredId)
    : undefined
  return declared ?? model.properties.find((p) => p.doc.name.toLowerCase() === 'id')
}

/** The identifier property NAME of a model (see {@link identifierProperty}). */
export function identifierName(model: DesignModel): string | undefined {
  const name = identifierProperty(model)?.doc.name
  return name === undefined || name === '' ? undefined : name
}

/** The outcome of a {@link DesignStatefulStore.remove}: the row was
 * removed, no row carried that id, or a `restrict` relation refused it. */
export type RemoveResult = 'removed' | 'not-found' | 'restricted'

/**
 * The ephemeral per-design store. Collections are keyed by model id;
 * rows keep insertion order. Deterministic: seeding and minted
 * identifiers derive from monotonic counters, never from randomness.
 */
export class DesignStatefulStore {
  private design: ApiDesign
  /** modelId → rows in insertion order. */
  private readonly rows = new Map<string, StatefulRow[]>()
  /** Per-model monotonic counter for minted identifiers, so a fresh POST
   * is reproducible and integer ids never collide. */
  private readonly counters = new Map<string, number>()
  /** Monotonic source for seed keys (buildModelInstance determinism). */
  private sequence = 0

  constructor(design: ApiDesign) {
    this.design = design
    this.seed()
  }

  /** Swap the design shape used by FUTURE operations without touching the
   * accumulated rows — a live design edit must not wipe the store (only a
   * server restart, i.e. a fresh instance, reseeds). */
  retarget(design: ApiDesign): void {
    this.design = design
  }

  /** Seed every model's collection from its NAMED examples. */
  private seed(): void {
    for (const model of this.design.models) {
      const rows: StatefulRow[] = []
      for (const example of model.examples ?? []) {
        rows.push(buildModelInstance(this.design, model, { exampleId: example.id, seedKey: `state:${example.id}` }))
      }
      this.rows.set(model.id, rows)
    }
  }

  private collection(model: DesignModel): StatefulRow[] {
    let rows = this.rows.get(model.id)
    if (rows === undefined) { rows = []; this.rows.set(model.id, rows) }
    return rows
  }

  /** A page of a model's collection (offset/limit clamped upstream). */
  list(model: DesignModel, options: { offset?: number; limit?: number }): { items: StatefulRow[]; total: number } {
    const rows = this.collection(model)
    const offset = Math.max(0, options.offset ?? 0)
    const limit = Math.max(1, options.limit ?? 20)
    return { items: rows.slice(offset, offset + limit), total: rows.length }
  }

  /** One row by identifier value (string-compared), or undefined. */
  get(model: DesignModel, idValue: string): StatefulRow | undefined {
    const key = identifierName(model)
    if (key === undefined) return undefined
    return this.collection(model).find((row) => String(row[key]) === idValue)
  }

  /**
   * Create a row from the inbound body: a fresh seeded instance carries
   * the model's shape and the body overrides it. The identifier is
   * SERVER-OWNED — it is always minted (by the model's strategy, unique
   * within the collection), overriding both the seeded value and any
   * client-supplied id — UNLESS the model declares no generation strategy
   * and the id property is writable (a natural key the client provides).
   * readOnly properties are never taken from the body.
   */
  create(model: DesignModel, body: Record<string, unknown>): StatefulRow {
    this.sequence += 1
    const base = buildModelInstance(this.design, model, { seedKey: `state:new:${this.sequence}` })
    const row: StatefulRow = { ...base }
    const key = identifierName(model)
    let clientSuppliedId = false
    for (const { property } of servedProperties(this.design, model)) {
      const name = property.doc.name
      if (name === '' || property.doc.readOnly === true) continue
      if (Object.prototype.hasOwnProperty.call(body, name)) {
        row[name] = body[name]
        if (name === key) clientSuppliedId = true
      }
    }
    if (key !== undefined) {
      const strategy = model.design?.identifier?.strategy
      // Mint unless the client legitimately supplies a natural key
      // (no generation strategy AND a writable id property).
      if (strategy !== undefined || !clientSuppliedId) {
        row[key] = this.mintIdentifier(model, key)
      }
    }
    this.collection(model).push(row)
    return row
  }

  /** Merge the body into an existing row (identifier stays); undefined
   * when no row carries that identifier. */
  update(model: DesignModel, idValue: string, body: Record<string, unknown>): StatefulRow | undefined {
    const key = identifierName(model)
    const row = this.get(model, idValue)
    if (row === undefined) return undefined
    for (const { property } of servedProperties(this.design, model)) {
      const name = property.doc.name
      if (name === '' || name === key || property.doc.readOnly === true) continue
      if (Object.prototype.hasOwnProperty.call(body, name)) row[name] = body[name]
    }
    return row
  }

  /**
   * Remove a row by identifier, applying the referential action of every
   * relation that points at it: `restrict` refuses ('restricted', the
   * caller answers 409), `cascade` removes the children (recursively),
   * `setNull` nulls the referencing field. Returns 'not-found' when no
   * row carries that identifier.
   */
  remove(model: DesignModel, idValue: string): RemoveResult {
    const key = identifierName(model)
    if (key === undefined) return 'not-found'
    const rows = this.collection(model)
    const index = rows.findIndex((row) => String(row[key]) === idValue)
    if (index === -1) return 'not-found'
    // A `restrict` relation still referencing this row blocks the delete.
    if (this.hasRestrictingReference(model, idValue)) return 'restricted'
    rows.splice(index, 1)
    this.applyReferentialActions(model, idValue)
    return 'removed'
  }

  /** Any row in another model references `(model, idValue)` through a
   * `restrict` relation (the default) — the delete must be refused. */
  private hasRestrictingReference(parent: DesignModel, parentId: string): boolean {
    for (const child of this.design.models) {
      for (const property of child.properties) {
        const reference = property.design?.reference
        if (reference?.target !== 'model' || reference.refId !== parent.id) continue
        if ((reference.onDelete ?? 'restrict') !== 'restrict') continue
        const fieldName = property.doc.name
        if (this.collection(child).some((row) => String(row[fieldName]) === parentId)) return true
      }
    }
    return false
  }

  /** Apply `cascade` (remove children, recursively) and `setNull` (null
   * the referencing field) for every relation pointing at the removed
   * `(parent, parentId)`. `restrict` was already vetoed in {@link remove}. */
  private applyReferentialActions(parent: DesignModel, parentId: string): void {
    for (const child of this.design.models) {
      for (const property of child.properties) {
        const reference = property.design?.reference
        if (reference?.target !== 'model' || reference.refId !== parent.id) continue
        const onDelete = reference.onDelete ?? 'restrict'
        const fieldName = property.doc.name
        const rows = this.collection(child)
        if (onDelete === 'setNull') {
          for (const row of rows) if (String(row[fieldName]) === parentId) row[fieldName] = null
          continue
        }
        if (onDelete !== 'cascade') continue
        const childKey = identifierName(child)
        // Collect victims first — removing in place while iterating skips.
        const victims = rows.filter((row) => String(row[fieldName]) === parentId)
        for (const victim of victims) {
          const childId = childKey !== undefined ? String(victim[childKey]) : undefined
          const at = rows.indexOf(victim)
          if (at !== -1) rows.splice(at, 1)
          if (childId !== undefined) this.applyReferentialActions(child, childId)
        }
      }
    }
  }

  /** Mint a fresh identifier per the model's strategy, unique within the
   * collection (skips any value a seeded example already holds). */
  private mintIdentifier(model: DesignModel, key: string): string | number {
    const strategy = model.design?.identifier?.strategy
    const slug = model.doc.name.toLowerCase()
    const existing = new Set(this.collection(model).map((row) => String(row[key])))
    for (let attempt = 0; attempt < 1_000_000; attempt++) {
      const n = (this.counters.get(model.id) ?? 0) + 1
      this.counters.set(model.id, n)
      const candidate: string | number =
        strategy === 'autoIncrement' ? n
          : strategy === 'uuid' ? `generated-${slug}-${n}`
            : strategy === 'ulid' ? `ulid-${slug}-${n}`
              : `${slug}-${n}`
      if (!existing.has(String(candidate))) return candidate
    }
    // Unreachable in practice (the counter always finds a free slot).
    return `${slug}-${this.sequence}`
  }
}
