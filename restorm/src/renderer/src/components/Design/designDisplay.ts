import type { DesignProperty } from '../../../../shared/types/collections'

/** Render an `unknown` design value (example, default, enum member) as
 * the string a field or cell shows — objects go through JSON so they
 * never degrade to `[object Object]`. */
export function displayValue(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  // JSON.stringify types as `string` but yields undefined for symbols /
  // functions — coalesce through an unknown-typed local.
  const json: unknown = JSON.stringify(value)
  return typeof json === 'string' ? json : ''
}

/**
 * Parse a typed-in value according to the property's declared type, so
 * numbers and booleans round-trip as their real JSON type — the ONE
 * door every editor of a typed value field (`doc.example`, example
 * values) writes through; a field storing the raw string would ship
 * `"42"` where the schema says integer.
 */
export function parseTypedValue(property: DesignProperty, raw: string): unknown {
  const type = property.doc.type
  if (type === 'integer' || type === 'number') {
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : raw
  }
  if (type === 'boolean') {
    if (raw === 'true') return true
    if (raw === 'false') return false
    return raw
  }
  // A model-referenced property spells the MODEL NAME as its doc type
  // (fixture/importer convention), so it matches no primitive branch —
  // its example is an object and goes through JSON. Enum references
  // stay out: their doc type is 'string' and their values are strings.
  const isModelRef = property.design?.reference?.target === 'model'
  if (type === 'array' || type === 'map' || type === 'object' || isModelRef) {
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  }
  return raw
}

/**
 * The raw-type variant of {@link parseTypedValue}, for surfaces whose
 * type is a bare string rather than a full property (route parameter
 * rows). Same branches, no reference awareness.
 */
export function parseTypedRaw(type: string, raw: string): unknown {
  return parseTypedValue({ id: '', doc: { name: '', type, required: false } }, raw)
}

/**
 * The value half of the bridge, exported for unit tests: a row text
 * matching a previous value's RENDERING keeps the original (typed)
 * value — deletions and drag-reorders shift positions, so the match is
 * by rendered string, never by index. Ambiguity (two members rendering
 * identically) is a state validation already rejects.
 */
export function bridgeEnumValues(previousValues: readonly unknown[], labels: readonly string[]): unknown[] {
  const previousByRender = new Map(previousValues.map((value) => [displayValue(value), value]))
  return labels
    .filter((label) => label.trim() !== '')
    .map((label) => {
      const previous = previousByRender.get(label)
      return previous !== undefined ? previous : label
    })
}
