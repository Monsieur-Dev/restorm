/**
 * OData v4 projection of an API design.
 *
 * Models become EntityTypes (their declared identifier is the Key),
 * enums become EnumTypes, and every model gets an EntitySet named after
 * its plural — the natural OData reading of the design, independent of
 * the HTTP routes. The emitted `$metadata` (CSDL) round-trips through
 * the app's own EDMX importer, and the served collections are built on
 * the same serving kernel as every other projection (named examples
 * first, seeded faker beyond them) so `$filter`/`$top`/`$select` from
 * `odataServerQuery` operate on deterministic rows.
 */

import type { ApiDesign, DesignModel } from '../types/apiDesign'
import { buildModelInstance, servedProperties, servedTotal } from './designServing'
import { pluralize } from './designRoutes'

/** Served collections stay bounded: query options page WITHIN this. */
export const ODATA_MAX_SERVED_ROWS = 50

// ── Names ─────────────────────────────────────────────────────────────

/** Sanitize to a CSDL SimpleIdentifier (`[A-Za-z_][A-Za-z0-9_]*`). */
function sanitizeEdmName(raw: string, fallback: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
  const named = cleaned === '' ? fallback : cleaned
  return /^[0-9]/.test(named) ? `_${named}` : named
}

/** The schema namespace the design projects into. */
export function designODataNamespace(design: ApiDesign): string {
  return sanitizeEdmName(design.info.title !== '' ? design.info.title : design.name, 'DesignService')
}

export interface ODataEntitySet {
  /** EntitySet name (the URL segment), e.g. `Users`. */
  name: string
  /** EntityType name, e.g. `User`. */
  typeName: string
  model: DesignModel
}

/** One EntitySet per model, collision-free. */
export function designODataEntitySets(design: ApiDesign): ODataEntitySet[] {
  const taken = new Set<string>()
  const sets: ODataEntitySet[] = []
  for (const model of design.models) {
    const typeName = sanitizeEdmName(model.doc.name, 'Entity')
    let name = sanitizeEdmName(pluralize(typeName), `${typeName}Set`)
    let n = 2
    while (taken.has(name)) { name = `${sanitizeEdmName(pluralize(typeName), `${typeName}Set`)}${n}`; n += 1 }
    taken.add(name)
    sets.push({ name, typeName, model })
  }
  return sets
}

/** The model's key property NAME across its inheritance chain: the
 * nearest declared identifier, else a property literally named `id`,
 * else the first served property. */
export function odataKeyPropertyName(design: ApiDesign, model: DesignModel): string | undefined {
  const served = servedProperties(design, model)
  const chain: DesignModel[] = []
  let current: DesignModel | undefined = model
  const visited = new Set<string>()
  while (current !== undefined && !visited.has(current.id)) {
    visited.add(current.id)
    chain.push(current)
    const parentId: string | undefined = current.design?.inheritsFrom
    current = parentId === undefined ? undefined : design.models.find((m) => m.id === parentId)
  }
  for (const owner of chain) {
    const identifierId = owner.design?.identifier?.propertyId
    const identifier = identifierId !== undefined
      ? owner.properties.find((p) => p.id === identifierId)
      : undefined
    if (identifier !== undefined && identifier.doc.name !== '') return identifier.doc.name
  }
  const named = served.find(({ property }) => property.doc.name.toLowerCase() === 'id')
    ?? served[0]
  const name = named?.property.doc.name
  return name === undefined || name === '' ? undefined : name
}

// ── CSDL emission ─────────────────────────────────────────────────────

/** Map a design property to its Edm type. */
function edmType(design: ApiDesign, namespace: string, property: DesignModel['properties'][number]): { type: string; collection: boolean; navigation: boolean } {
  const reference = property.design?.reference
  if (reference !== undefined) {
    if (reference.target === 'enum') {
      const enum_ = design.enums.find((e) => e.id === reference.refId)
      if (enum_ !== undefined) {
        return { type: `${namespace}.${sanitizeEdmName(enum_.doc.name, 'Enum')}`, collection: false, navigation: false }
      }
    } else {
      const model = design.models.find((m) => m.id === reference.refId)
      if (model !== undefined) {
        return {
          type: `${namespace}.${sanitizeEdmName(model.doc.name, 'Entity')}`,
          collection: property.doc.isArrayOfRef === true,
          navigation: true
        }
      }
    }
  }
  const label = property.doc.type
  const array = /^array<(.+)>$/.exec(label)
  if (array?.[1] !== undefined) return { type: edmScalar(array[1], undefined), collection: true, navigation: false }
  if (label === 'array') {
    return { type: edmScalar(property.design?.arrayItems?.type ?? 'string', undefined), collection: true, navigation: false }
  }
  return { type: edmScalar(label, property.doc.format), collection: false, navigation: false }
}

function edmScalar(label: string, format: string | undefined): string {
  if (label === 'integer') return format === 'int64' ? 'Edm.Int64' : 'Edm.Int32'
  if (label === 'number') return 'Edm.Double'
  if (label === 'boolean') return 'Edm.Boolean'
  if (label === 'string' && format === 'uuid') return 'Edm.Guid'
  if (label === 'string' && format === 'date-time') return 'Edm.DateTimeOffset'
  if (label === 'string' && format === 'date') return 'Edm.Date'
  return 'Edm.String'
}

function xmlEscape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Emit the design's `$metadata` document (EDMX wrapping CSDL 4.0). The
 * shape mirrors what `parseEdmxV4` reads back: EntityType + Key +
 * Property + NavigationProperty, EnumType + Member, and an
 * EntityContainer of EntitySets.
 */
export function designToCsdl(design: ApiDesign): string {
  const namespace = designODataNamespace(design)
  const sets = designODataEntitySets(design)
  const lines: string[] = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx" Version="4.0">',
    '  <edmx:DataServices>',
    `    <Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="${xmlEscape(namespace)}">`
  ]

  for (const enum_ of design.enums) {
    const values = enum_.doc.enumValues ?? []
    if (values.length === 0) continue
    lines.push(`      <EnumType Name="${xmlEscape(sanitizeEdmName(enum_.doc.name, 'Enum'))}">`)
    values.forEach((value, index) => {
      lines.push(`        <Member Name="${xmlEscape(sanitizeEdmName(String(value), `Value${index}`))}" Value="${index}" />`)
    })
    lines.push('      </EnumType>')
  }

  for (const set of sets) {
    const keyName = odataKeyPropertyName(design, set.model)
    lines.push(`      <EntityType Name="${xmlEscape(set.typeName)}">`)
    if (keyName !== undefined) {
      lines.push('        <Key>', `          <PropertyRef Name="${xmlEscape(keyName)}" />`, '        </Key>')
    }
    for (const { property } of servedProperties(design, set.model)) {
      const name = property.doc.name
      if (name === '') continue
      const mapped = edmType(design, namespace, property)
      const type = mapped.collection ? `Collection(${mapped.type})` : mapped.type
      const element = mapped.navigation ? 'NavigationProperty' : 'Property'
      const nullable = mapped.navigation || (!property.doc.required && name !== keyName)
      lines.push(`        <${element} Name="${xmlEscape(name)}" Type="${type}"${nullable ? '' : ' Nullable="false"'} />`)
    }
    lines.push('      </EntityType>')
  }

  lines.push(`      <EntityContainer Name="${xmlEscape(namespace)}Container">`)
  for (const set of sets) {
    lines.push(`        <EntitySet Name="${xmlEscape(set.name)}" EntityType="${xmlEscape(namespace)}.${xmlEscape(set.typeName)}" />`)
  }
  lines.push(
    '      </EntityContainer>',
    '    </Schema>',
    '  </edmx:DataServices>',
    '</edmx:Edmx>',
    ''
  )
  return lines.join('\n')
}

// ── Served rows ───────────────────────────────────────────────────────

/**
 * The deterministic rows an EntitySet serves: named examples first,
 * seeded instances beyond, bounded by {@link ODATA_MAX_SERVED_ROWS}
 * (system query options page within the bound).
 */
export function buildODataRows(design: ApiDesign, model: DesignModel): Record<string, unknown>[] {
  const count = Math.min(Math.max(servedTotal(model), (model.examples ?? []).length), ODATA_MAX_SERVED_ROWS)
  const examples = model.examples ?? []
  const rows: Record<string, unknown>[] = []
  for (let i = 0; i < count; i++) {
    const named = examples[i]
    rows.push(named !== undefined
      ? buildModelInstance(design, model, { exampleId: named.id, seedKey: `odata:${i}` })
      : buildModelInstance(design, model, { seedKey: `odata:${i}` }))
  }
  return rows
}

/** Match an addressed entity (`Set(<key>)`) against the served rows:
 * quotes stripped, compared as strings against the key property. */
export function matchODataEntity(
  design: ApiDesign,
  model: DesignModel,
  rows: Record<string, unknown>[],
  rawKey: string
): Record<string, unknown> | undefined {
  const keyName = odataKeyPropertyName(design, model)
  if (keyName === undefined) return undefined
  const key = rawKey.replace(/^'(.*)'$/, '$1')
  return rows.find((row) => String(row[keyName]) === key)
}
