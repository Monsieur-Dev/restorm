/**
 * Metadata resolvers that turn an imported `ApiDocumentation` + the
 * bound `entityTypeRef` of an OData request into the suggestion lists
 * the `$filter` autocomplete needs: properties, type-appropriate
 * operators, and value suggestions (enum members, true/false, date /
 * GUID hints).
 *
 * Pure + Monaco-free so the completion / validation logic is unit
 * tested directly; the Monaco language contribution is a thin shell
 * that feeds `classifyCursor` output into these resolvers.
 */

import type {
  ApiDocumentation,
  ModelDocumentation,
  PropertyDocumentation
} from '../../types/apiDocumentation'
import { COMPARISON_OPERATORS } from './odataFilterGrammar'

/** A property + navigation suggestion for the property position. */
export interface PropertySuggestion {
  name: string
  /** The Edm type label (e.g. `Edm.String`, `Collection(Edm.Int32)`,
   * `OData.PetStore.Models.PetStatus`). */
  type: string
  /** True for a navigation property (points at another entity type) —
   * the UI can offer the `Nav/Property` path drill-down. */
  isNavigation: boolean
}

/** A value-position suggestion. `insertText` may differ from `label`
 * (e.g. an enum member inserts quoted-or-bare depending on the
 * underlying type). */
export interface ValueSuggestion {
  label: string
  insertText: string
  /** Short detail surfaced next to the suggestion (e.g. `enum`,
   * `boolean`). */
  detail?: string
}

/** String-only filter functions — offered as value/leading suggestions
 * only for `Edm.String` properties. */
const STRING_FUNCTIONS = [
  'contains',
  'endswith',
  'startswith',
  'indexof',
  'substring',
  'tolower',
  'toupper',
  'trim',
  'concat',
  'length'
] as const

const STRING_FUNCTION_SET: ReadonlySet<string> = new Set(STRING_FUNCTIONS)

/** Strip a `Collection(...)` wrapper, returning the element type. */
export function unwrapCollectionType(type: string): { inner: string; collection: boolean } {
  const m = /^Collection\((.+)\)$/.exec(type.trim())
  if (m?.[1]) return { inner: m[1], collection: true }
  return { inner: type, collection: false }
}

/** Resolve the `ModelDocumentation` for a request's bound entity type.
 * Returns undefined when there's no metadata or no `entityTypeRef`
 * (hand-authored request) — the caller then offers no suggestions. */
export function resolveEntityType(
  apiDoc: ApiDocumentation | undefined,
  entityTypeRef: string | undefined
): ModelDocumentation | undefined {
  if (!apiDoc || !entityTypeRef) return undefined
  return apiDoc.models[entityTypeRef]
}

/** Walk a navigation `Customer/Address` path from a root entity type,
 * returning the model the path resolves to (or undefined when a
 * segment can't be resolved). The final segment of a comparison path
 * (`Customer/Name`) is a property, not a nav — callers pass only the
 * navigation portion. */
function resolveModelForPath(
  apiDoc: ApiDocumentation | undefined,
  rootRef: string | undefined,
  navSegments: readonly string[]
): ModelDocumentation | undefined {
  const root = resolveEntityType(apiDoc, rootRef)
  if (!root || !apiDoc) return undefined
  let model: ModelDocumentation = root
  for (const seg of navSegments) {
    const prop: PropertyDocumentation | undefined = modelProperties(model).find((p) => p.name === seg)
    if (!prop?.targetModelRef) return undefined
    const next: ModelDocumentation | undefined = apiDoc.models[prop.targetModelRef]
    if (!next) return undefined
    model = next
  }
  return model
}

/** Read a model's `properties`, tolerating the runtime reality that
 * the OData importer emits enum models WITHOUT a `properties` array
 * even though `ModelDocumentation` types it as required. Centralises
 * the one type-vs-runtime mismatch so every reader is crash-safe. */
function modelProperties(model: ModelDocumentation): PropertyDocumentation[] {
  return (model as { properties?: PropertyDocumentation[] }).properties ?? []
}

/** All structural + navigation properties of a model, mapped to
 * suggestions. A property is treated as navigation when it points at
 * another object model via `targetModelRef`. */
export function propertiesFor(
  model: ModelDocumentation | undefined,
  apiDoc?: ApiDocumentation
): PropertySuggestion[] {
  if (!model) return []
  return modelProperties(model).map((p) => ({
    name: p.name,
    type: p.type,
    isNavigation: isNavigationProperty(p, apiDoc)
  }))
}

/** A property is a navigation when its `targetModelRef` resolves to an
 * object model (one with properties) rather than an enum. Without an
 * apiDoc we fall back to "has a ref" — good enough for hint chips. */
function isNavigationProperty(
  prop: PropertyDocumentation,
  apiDoc?: ApiDocumentation  
): boolean {
  if (!prop.targetModelRef) return false
  if (!apiDoc) return true
  const target = apiDoc.models[prop.targetModelRef]
  if (!target) return true
  // An enum target is a value type, not a navigation. Enum models are
  // emitted without a `properties` array, so treat a missing/empty
  // `properties` as "not an object model".
  return modelProperties(target).length > 0
}

/** Find a property on a model by name (case-sensitive — OData property
 * names are case-sensitive). */
function findProperty(
  model: ModelDocumentation | undefined,
  name: string
): PropertyDocumentation | undefined {
  if (!model) return undefined
  return modelProperties(model).find((p) => p.name === name)
}

/** Resolve a (possibly navigation) property path against a root entity
 * type to its terminal `PropertyDocumentation`. `Customer/Name`
 * resolves `Customer` → its model → `Name`. */
export function resolvePropertyPath(
  apiDoc: ApiDocumentation | undefined,
  rootRef: string | undefined,
  path: string
): PropertyDocumentation | undefined {
  const segments = path.split('/').filter(Boolean)
  const last = segments[segments.length - 1]
  if (last === undefined) return undefined
  const navSegments = segments.slice(0, -1)
  const model =
    navSegments.length === 0
      ? resolveEntityType(apiDoc, rootRef)
      : resolveModelForPath(apiDoc, rootRef, navSegments)
  return findProperty(model, last)
}

/** Whether a (collection-unwrapped) Edm type is the string type. */
function isStringType(edmType: string): boolean {
  return unwrapCollectionType(edmType).inner === 'Edm.String'
}

/** The applicable comparison/membership operators for a property type.
 * Every type gets equality/ordering comparisons; `has` is added for
 * enum-typed properties (bitmask check); `in` is always available
 * (membership test). */
export function operatorsForType(_edmType: string, isEnum = false): string[] {
  const ops: string[] = COMPARISON_OPERATORS.filter((o) => o !== 'has')
  if (isEnum) ops.push('has')
  return ops
}

/** The leading filter functions applicable to a property type. Only
 * string properties get the string-function set; non-string properties
 * get none (numeric / date functions apply to expressions, not the
 * common property-position completion). */
export function functionsForType(edmType: string): string[] {
  if (isStringType(edmType)) return [...STRING_FUNCTIONS]
  return []
}

/** Whether a name is a string-only filter function. */
export function isStringFunction(name: string): boolean {
  return STRING_FUNCTION_SET.has(name.toLowerCase())
}

/** Read the enum members of an enum model, tolerating both the typed
 * `enumValues` field (populated by `mergeEnumDefinitionsIntoModels`)
 * and the importer's runtime `enum: string[]` field. */
function enumMembersOf(model: ModelDocumentation | undefined): string[] {
  if (!model) return []
  const out: string[] = []
  if (Array.isArray(model.enumValues)) {
    for (const v of model.enumValues) if (typeof v === 'string') out.push(v)
  }
  if (out.length === 0) {
    const runtimeEnum = (model as { enum?: unknown }).enum
    if (Array.isArray(runtimeEnum)) {
      for (const v of runtimeEnum) if (typeof v === 'string') out.push(v)
    }
  }
  return out
}

/**
 * Value suggestions for the position after a comparison operator,
 * derived from the property's type:
 *  - enum-typed (via `targetModelRef` → enum model): the members,
 *    inserted as quoted literals (`'Available'`);
 *  - boolean: `true` / `false`;
 *  - date / datetime: an ISO snippet placeholder;
 *  - GUID: a UUID-shaped placeholder;
 *  - numbers / strings: no concrete values (just a typed hint).
 */
export function valueSuggestionsForProperty(
  prop: PropertyDocumentation | undefined,
  apiDoc: ApiDocumentation | undefined
): ValueSuggestion[] {
  if (!prop) return []

  // Enum values — the richest case (AC #3).
  if (prop.targetModelRef && apiDoc) {
    const enumModel = apiDoc.models[prop.targetModelRef]
    const members = enumMembersOf(enumModel)
    if (members.length > 0) {
      return members.map((m) => ({
        label: m,
        insertText: `'${m}'`,
        detail: 'enum'
      }))
    }
  }

  const inner = unwrapCollectionType(prop.type).inner
  const fmt = prop.format

  if (inner === 'Edm.Boolean' || fmt === 'boolean') {
    return [
      { label: 'true', insertText: 'true', detail: 'boolean' },
      { label: 'false', insertText: 'false', detail: 'boolean' }
    ]
  }

  if (fmt === 'date' || inner === 'Edm.Date') {
    return [{ label: 'YYYY-MM-DD', insertText: '${1:2024-01-01}', detail: 'date' }]
  }

  if (fmt === 'date-time' || inner === 'Edm.DateTimeOffset') {
    return [{ label: 'ISO date-time', insertText: '${1:2024-01-01T00:00:00Z}', detail: 'date-time' }]
  }

  if (fmt === 'uuid' || inner === 'Edm.Guid') {
    return [
      {
        label: 'GUID',
        insertText: '${1:00000000-0000-0000-0000-000000000000}',
        detail: 'guid'
      }
    ]
  }

  return []
}

/** Whether a comparison operator is type-appropriate for a property —
 * drives the wrong-type validation warning. String properties reject
 * ordering operators (`gt`/`ge`/`lt`/`le`) since lexical ordering is
 * rarely intended; everything accepts `eq`/`ne`/`in`; enums accept
 * `has`. */
export function isOperatorValidForType(
  operator: string,
  edmType: string,
  isEnum = false
): boolean {
  const op = operator.toLowerCase()
  if (op === 'has') return isEnum
  if (op === 'eq' || op === 'ne' || op === 'in') return true
  if (op === 'gt' || op === 'ge' || op === 'lt' || op === 'le') {
    // Ordering is meaningful for numbers, dates, and durations — not
    // booleans, not enums.
    if (isEnum) return false
    const inner = unwrapCollectionType(edmType).inner
    if (inner === 'Edm.Boolean') return false
    return true
  }
  return true
}
