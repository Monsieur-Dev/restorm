import { createHash } from 'node:crypto'
import type { NormalizedSpec } from '../import/idempotent/types'

/**
 * Compute a structural content hash of a `NormalizedSpec` so the
 * checker can detect changes the spec author shipped without bumping
 * `info.version`.
 *
 * Implementation:
 *
 * - Sort operations by `naturalKey`, models by `name`, enums by
 *   `name`. Adapter output already produces stable orderings, but
 *   pinning the sort here keeps the hash robust to any future
 *   adapter that emits things in a non-deterministic order
 *   (e.g. iterating over an unordered Map / Set).
 * - Strip transient fields the operator might tolerate without
 *   wanting a notification: documentation strings, parameter
 *   descriptions, default values shown in the UI. The pipeline
 *   still merges those changes when the user applies an update;
 *   they just don't trigger the "update available" toast on
 *   their own.
 * - SHA-256 over the canonical JSON. Any cryptographic hash works;
 *   SHA-256 keeps the hash short enough to live happily in a YAML
 *   field.
 */
export function computeSpecHash(spec: NormalizedSpec): string {
  const canonical = canonicaliseSpec(spec)
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`
}

function canonicaliseSpec(spec: NormalizedSpec): string {
  const operations = spec.operations.slice().sort((a, b) => a.naturalKey.localeCompare(b.naturalKey))
  const models = spec.models.slice().sort((a, b) => a.name.localeCompare(b.name))
  const enums = spec.enums.slice().sort((a, b) => a.name.localeCompare(b.name))
  return JSON.stringify({
    operations: operations.map((op) => ({
      operationId: op.operationId,
      naturalKey: op.naturalKey,
      deprecated: op.deprecated,
      shape: stripDescriptions(op.shape)
    })),
    models: models.map((m) => ({
      name: m.name,
      deprecated: m.deprecated,
      properties: m.properties.map((p) => ({
        name: p.name,
        type: p.type,
        required: p.required,
        deprecated: p.deprecated
      }))
    })),
    enums: enums.map((e) => ({
      name: e.name,
      values: e.values.slice(),
      deprecated: e.deprecated
    }))
  })
}

function stripDescriptions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => stripDescriptions(v))
  if (value !== null && typeof value === 'object') {
    const obj: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'description' || key === 'defaultValue') continue
      obj[key] = stripDescriptions(v)
    }
    return obj
  }
  return value
}
