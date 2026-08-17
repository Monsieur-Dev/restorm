/**
 * The stateful mode of the design server (TASK-468 mode B): an
 * EPHEMERAL in-memory store per served design. A POST really adds an
 * object, the next GET lists it, PUT/PATCH edits it, DELETE removes it,
 * and relations are honoured (deleting a row cascades to rows that
 * reference it with `onDelete: cascade`). The store SEEDS from the
 * models' named examples and resets whenever the server restarts.
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

/** The identifier property NAME of a model (its declared identifier,
 * else a property literally named `id`, else undefined). */
export function identifierName(model: DesignModel): string | undefined {
  const declaredId = model.design?.identifier?.propertyId
  const declared = declaredId !== undefined
    ? model.properties.find((p) => p.id === declaredId)
    : undefined
  const named = declared ?? model.properties.find((p) => p.doc.name.toLowerCase() === 'id')
  const name = named?.doc.name
  return name === undefined || name === '' ? undefined : name
}

/**
 * The ephemeral per-design store. Collections are keyed by model id;
 * rows keep insertion order. Deterministic: seeding and generated
 * identifiers derive from a monotonic counter, never from randomness.
 */
export class DesignStatefulStore {
  private readonly design: ApiDesign
  /** modelId → rows in insertion order. */
  private readonly rows = new Map<string, StatefulRow[]>()
  /** Monotonic source for generated identifiers (autoIncrement + the
   * uuid-less fallback), so a fresh POST is reproducible. */
  private sequence = 0

  constructor(design: ApiDesign) {
    this.design = design
    this.seed()
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
   * the model's shape, the body overrides it, and the identifier is
   * minted when the body omits it (uuid → seeded value, autoIncrement →
   * the counter, else a `<model>-<n>` token). readOnly properties are
   * NOT taken from the body — they are server-owned.
   */
  create(model: DesignModel, body: Record<string, unknown>): StatefulRow {
    this.sequence += 1
    const base = buildModelInstance(this.design, model, { seedKey: `state:new:${this.sequence}` })
    const row: StatefulRow = { ...base }
    for (const { property } of servedProperties(this.design, model)) {
      const name = property.doc.name
      if (name === '' || property.doc.readOnly === true) continue
      if (Object.prototype.hasOwnProperty.call(body, name)) row[name] = body[name]
    }
    const key = identifierName(model)
    if (key !== undefined && (row[key] === undefined || row[key] === null || row[key] === '')) {
      row[key] = this.mintIdentifier(model)
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
   * Remove a row by identifier. Returns false when absent. Cascade:
   * every row in another model that references this one through a
   * `onDelete: cascade` relation is removed too (recursively).
   */
  remove(model: DesignModel, idValue: string): boolean {
    const key = identifierName(model)
    if (key === undefined) return false
    const rows = this.collection(model)
    const index = rows.findIndex((row) => String(row[key]) === idValue)
    if (index === -1) return false
    rows.splice(index, 1)
    this.cascade(model, idValue)
    return true
  }

  /** Cascade-delete rows referencing the removed `(model, idValue)`
   * through an `onDelete: cascade` relation. */
  private cascade(parent: DesignModel, parentId: string): void {
    for (const child of this.design.models) {
      for (const property of child.properties) {
        const reference = property.design?.reference
        if (reference?.target !== 'model' || reference.refId !== parent.id) continue
        if (reference.onDelete !== 'cascade') continue
        const fieldName = property.doc.name
        const childKey = identifierName(child)
        const rows = this.collection(child)
        // Collect the child ids to remove first, then recurse — removing
        // in place while iterating would skip entries.
        const victims = rows.filter((row) => String(row[fieldName]) === parentId)
        for (const victim of victims) {
          const childId = childKey !== undefined ? String(victim[childKey]) : undefined
          const at = rows.indexOf(victim)
          if (at !== -1) rows.splice(at, 1)
          if (childId !== undefined) this.cascade(child, childId)
        }
      }
    }
  }

  private mintIdentifier(model: DesignModel): string | number {
    const strategy = model.design?.identifier?.strategy
    if (strategy === 'autoIncrement') return this.sequence
    if (strategy === 'uuid') return `generated-${this.sequence}`
    return `${model.doc.name.toLowerCase()}-${this.sequence}`
  }
}
