/**
 * Seeded, reproducible example values for design properties — the
 * "faker" half of named examples: a property with no defined value in a
 * `DesignExample` gets a value derived from its type/format, seeded by
 * (design, model, example, property) so every run, every machine and
 * every projection (design server, docs, doc-shots) agree byte-for-byte.
 *
 * Built on the existing deterministic PRNG (`shared/scenarioRandom.ts`
 * — mulberry32 over an FNV-1a string hash); no new dependency.
 */

import { hashString, mulberry32 } from '../scenarioRandom'
import type { ApiDesign, DesignModel, DesignProperty, DesignExample } from '../types/apiDesign'

const FIRST_NAMES = ['Ada', 'Linus', 'Grace', 'Alan', 'Edsger', 'Barbara', 'Donald', 'Margaret'] as const
const LAST_NAMES = ['Lovelace', 'Hopper', 'Turing', 'Liskov', 'Dijkstra', 'Knuth', 'Hamilton', 'Curie'] as const
const WORDS = ['alpha', 'bravo', 'delta', 'echo', 'lima', 'nova', 'orion', 'zephyr'] as const

/** The seed string for one property of one example. Stable contract:
 * changing it changes every auto value in every existing design. */
export function exampleValueSeed(designId: string, modelId: string, exampleId: string, propertyId: string): string {
  return `${designId}/${modelId}/${exampleId}/${propertyId}`
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)] as T
}

function hexByte(rng: () => number): string {
  return Math.floor(rng() * 256).toString(16).padStart(2, '0')
}

function seededUuid(rng: () => number): string {
  const bytes = Array.from({ length: 16 }, () => Math.floor(rng() * 256))
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function seededDate(rng: () => number): string {
  // A stable, plausible window (2024-2026) — NOT "now": now is not
  // reproducible.
  const start = Date.UTC(2024, 0, 1)
  const end = Date.UTC(2026, 11, 31)
  const at = new Date(start + Math.floor(rng() * (end - start)))
  return at.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** Generate the auto value for a property, honouring its type/format,
 * enum reference and constraints (min/max, length bounds). */
export function generateExampleValue(design: ApiDesign, _model: DesignModel, property: DesignProperty, seed: string): unknown {
  const rng = mulberry32(hashString(seed))
  const doc = property.doc

  // An array property yields an ARRAY of element values, never a scalar —
  // the element type is the primitive `arrayItems.type`, or the enum the
  // reference points at. (A nested-model array is left to the caller's
  // instance builder; here it degrades to element scalars.) Recursion is
  // bounded: the element property is never itself typed `array`.
  if (doc.type === 'array') {
    const count = 1 + Math.floor(rng() * 3)
    const element = arrayElementProperty(property)
    return Array.from({ length: count }, (_v, i) =>
      generateExampleValue(design, _model, element, `${seed}#${i}`))
  }

  // An enum-typed property picks one of its enum's values.
  const reference = property.design?.reference
  if (reference?.target === 'enum') {
    const target = design.enums.find((e) => e.id === reference.refId)
    const values = target?.doc.enumValues ?? []
    if (values.length > 0) return pick(rng, values)
  }
  if (Array.isArray(doc.enumValues) && doc.enumValues.length > 0) {
    return pick(rng, doc.enumValues)
  }

  const type = doc.type
  const format = doc.format ?? ''

  if (type === 'integer' || type === 'number') {
    const min = doc.constraints?.minimum ?? 1
    const max = doc.constraints?.maximum ?? (type === 'integer' ? 10_000 : 1_000)
    const raw = min + rng() * (max - min)
    return type === 'integer' ? Math.floor(raw) : Math.round(raw * 100) / 100
  }
  if (type === 'boolean') return rng() < 0.5

  // Strings by format.
  if (format === 'uuid') return seededUuid(rng)
  if (format === 'email') return `${pick(rng, FIRST_NAMES).toLowerCase()}.${pick(rng, LAST_NAMES).toLowerCase()}@example.com`
  if (format === 'date-time') return seededDate(rng)
  if (format === 'date') return seededDate(rng).slice(0, 10)
  if (format === 'uri' || format === 'url') return `https://example.com/${pick(rng, WORDS)}/${Math.floor(rng() * 1000)}`
  if (format === 'hostname') return `${pick(rng, WORDS)}.example.com`
  if (format === 'ipv4') return `10.${Math.floor(rng() * 255)}.${Math.floor(rng() * 255)}.${Math.floor(rng() * 255)}`

  // Name-guided plain strings read better in served examples.
  const name = doc.name.toLowerCase()
  if (name.includes('name')) return `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`
  const base = `${pick(rng, WORDS)}-${hexByte(rng)}${hexByte(rng)}`
  const minLength = doc.constraints?.minLength
  const maxLength = doc.constraints?.maxLength
  let value = base
  if (typeof minLength === 'number' && value.length < minLength) value = value.padEnd(minLength, 'x')
  if (typeof maxLength === 'number' && value.length > maxLength) value = value.slice(0, maxLength)
  return value
}

/** Project an array property onto a single-element property: the element
 * carries the primitive `arrayItems` type (or the reference the array is
 * of), with all array-ness stripped so the value generator treats it as a
 * scalar/enum element. */
function arrayElementProperty(property: DesignProperty): DesignProperty {
  const { arrayItems: _items, ...designRest } = property.design ?? {}
  const reference = property.design?.reference
  if (reference !== undefined) {
    // enum/model array element: keep the reference (the enum branch fires
    // on it), drop the array flag, and force a non-array type so the value
    // generator can't recurse into this same branch.
    const { isArrayOfRef: _flag, ...docRest } = property.doc
    return {
      ...property,
      doc: { ...docRest, type: 'string' },
      design: designRest
    }
  }
  const itemType = property.design?.arrayItems?.type ?? 'string'
  const { format: _dropFormat, ...docRest } = property.doc
  return {
    ...property,
    doc: { ...docRest, type: itemType },
    design: designRest
  }
}

export type ExampleValueViolation = 'pattern' | 'minimum' | 'maximum' | 'minLength' | 'maxLength'

/** Check a DEFINED example value against the property's constraints —
 * the examples editor refuses (with a message) a value its own schema
 * rules out. Returns the first violated constraint, or null. */
export function violatedConstraint(property: DesignProperty, value: unknown): ExampleValueViolation | null {
  const constraints = property.doc.constraints
  if (constraints === undefined) return null
  if (typeof value === 'string') {
    if (typeof constraints.minLength === 'number' && value.length < constraints.minLength) return 'minLength'
    if (typeof constraints.maxLength === 'number' && value.length > constraints.maxLength) return 'maxLength'
    if (typeof constraints.pattern === 'string' && constraints.pattern !== '') {
      try {
        if (!new RegExp(constraints.pattern).test(value)) return 'pattern'
      } catch {
        // An invalid pattern is its own validation issue — not the value's.
      }
    }
  }
  if (typeof value === 'number') {
    if (typeof constraints.minimum === 'number' && value < constraints.minimum) return 'minimum'
    if (typeof constraints.maximum === 'number' && value > constraints.maximum) return 'maximum'
  }
  return null
}

/** Resolved view of one example row: the defined value, or the seeded
 * auto value, tagged with which it is. */
export function resolveExampleValue(
  design: ApiDesign,
  model: DesignModel,
  example: Pick<DesignExample, 'id' | 'values'>,
  property: DesignProperty
): { value: unknown; auto: boolean } {
  if (Object.prototype.hasOwnProperty.call(example.values, property.id)) {
    return { value: example.values[property.id], auto: false }
  }
  return {
    value: generateExampleValue(design, model, property, exampleValueSeed(design.id, model.id, example.id, property.id)),
    auto: true
  }
}
