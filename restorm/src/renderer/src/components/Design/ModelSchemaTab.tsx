import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  InputBox,
  MessageType,
  ScrollableElement,
  SelectBox,
  StaticPane,
  Table,
  Toggle,
  type IMessage,
  type ISelectData,
  type TableColumn
} from 'electron-core-ui/renderer'
import type {
  ApiDesign,
  DesignModel,
  DesignProperty,
  ReferenceOnDelete
} from '../../../../shared/types/collections'
import type { DesignIssue } from '../../../../shared/design/validateApiDesign'
import { generateUniqueId } from '../../utils/treeManipulation'
import { assignDesignSection, replaceModel, uniqueComponentName } from './designMutations'
import { displayValue, parseTypedValue } from './designDisplay'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'
import { DesignPropertyCodegenTab } from './DesignPropertyCodegenTab'
import { DesignEnumValuesEditor } from './DesignEnumValuesEditor'

/** The type vocabulary a property can pick from: primitives first, then
 * the design's models and enums (ID-referenced). */
type TypeChoice =
  | { kind: 'primitive'; name: string }
  | { kind: 'array' }
  | { kind: 'map' }
  | { kind: 'model'; id: string; name: string }
  | { kind: 'enum'; id: string; name: string }

const PRIMITIVES = ['string', 'integer', 'number', 'boolean'] as const

/** Title-case the alphanumeric words of a name for a synthesized enum name
 * (e.g. `Pet` + `status` → `PetStatus`). */
function pascalCase(input: string): string {
  return (input.match(/[A-Za-z0-9]+/g) ?? [])
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('')
}
const STRING_FORMATS = ['', 'email', 'uuid', 'date', 'date-time', 'uri', 'hostname', 'ipv4', 'password', 'byte'] as const
const ON_DELETE: readonly ReferenceOnDelete[] = ['restrict', 'cascade', 'setNull']

interface PropertyFlagSpec {
  key: string
  get: (p: DesignProperty) => boolean
  set: (p: DesignProperty, value: boolean) => DesignProperty
}

/** The toggle row of the property panel — one entry per flag, each
 * knowing where its bit lives (doc / design / intents). */
const PROPERTY_FLAGS: readonly PropertyFlagSpec[] = [
  {
    key: 'required',
    get: (p) => p.doc.required,
    set: (p, v) => ({ ...p, doc: { ...p.doc, required: v } })
  },
  {
    key: 'nullable',
    get: (p) => p.doc.nullable === true,
    set: (p, v) => ({ ...p, doc: setDocFlag(p.doc, 'nullable', v) })
  },
  {
    key: 'unique',
    get: (p) => p.design?.unique === true,
    set: (p, v) => withDesignFlag(p, 'unique', v)
  },
  {
    key: 'readOnly',
    get: (p) => p.doc.readOnly === true,
    set: (p, v) => ({ ...p, doc: setDocFlag(p.doc, 'readOnly', v) })
  },
  {
    key: 'writeOnly',
    get: (p) => p.design?.writeOnly === true,
    set: (p, v) => withDesignFlag(p, 'writeOnly', v)
  },
  {
    key: 'immutable',
    get: (p) => p.design?.immutable === true,
    set: (p, v) => withDesignFlag(p, 'immutable', v)
  },
  {
    key: 'pii',
    get: (p) => p.intents?.pii === true,
    set: (p, v) => {
      const { pii: _dropped, ...rest } = p.intents ?? {}
      const intents = v ? { ...rest, pii: true } : rest
      return rebuiltProperty(p, p.doc, intents, p.design)
    }
  },
  {
    key: 'searchable',
    get: (p) => p.design?.searchable === true,
    set: (p, v) => withDesignFlag(p, 'searchable', v)
  },
  {
    key: 'deprecated',
    get: (p) => p.doc.deprecated === true,
    set: (p, v) => ({ ...p, doc: setDocFlag(p.doc, 'deprecated', v) })
  }
]

function setDocFlag(doc: DesignProperty['doc'], key: 'nullable' | 'readOnly' | 'deprecated', value: boolean): DesignProperty['doc'] {
  const { [key]: _dropped, ...rest } = doc
  return value ? { ...rest, [key]: true } as DesignProperty['doc'] : rest as DesignProperty['doc']
}

/** Rebuild a property with its optional bags present only when they
 * still carry something — the shape `exactOptionalPropertyTypes` and
 * the serializer both want. */
function rebuiltProperty(
  p: DesignProperty,
  doc: DesignProperty['doc'],
  intents: DesignProperty['intents'],
  design: DesignProperty['design']
): DesignProperty {
  const next: DesignProperty = { id: p.id, doc }
  if (intents !== undefined && Object.keys(intents).length > 0) next.intents = intents
  if (design !== undefined && Object.keys(design).length > 0) next.design = design
  return next
}

function withDesignFlag(p: DesignProperty, key: 'unique' | 'writeOnly' | 'immutable' | 'searchable', value: boolean): DesignProperty {
  const { [key]: _dropped, ...rest } = p.design ?? {}
  const design = value ? { ...rest, [key]: true } : rest
  return rebuiltProperty(p, p.doc, p.intents, design)
}

/** Prune `undefined`-valued optional bags a flag update left behind so
 * the persisted shape stays free of explicit-undefined keys. */
function pruneProperty(p: DesignProperty): DesignProperty {
  const next: DesignProperty = { id: p.id, doc: p.doc }
  if (p.intents !== undefined) next.intents = p.intents
  if (p.design !== undefined) next.design = p.design
  return next
}

/** The current type choice a property encodes. */
function typeChoiceOf(property: DesignProperty): TypeChoice {
  const reference = property.design?.reference
  if (reference !== undefined && property.doc.type !== 'array') {
    return reference.target === 'model'
      ? { kind: 'model', id: reference.refId, name: '' }
      : { kind: 'enum', id: reference.refId, name: '' }
  }
  if (property.doc.type === 'array') return { kind: 'array' }
  if (property.doc.type === 'map') return { kind: 'map' }
  return { kind: 'primitive', name: property.doc.type }
}

export interface ModelSchemaTabProps {
  design: ApiDesign
  model: DesignModel
  issues: readonly DesignIssue[]
  selectedPropertyId: string | null
  onSelectProperty: (propertyId: string | null) => void
  onJumpToModel: (modelId: string) => void
}

/**
 * The Schéma tab: the model's property table (inherited rows first,
 * read-only and dimmed, then own rows), the add-property action, and
 * the click-to-edit panel of the selected property.
 */
export const ModelSchemaTab: React.FC<ModelSchemaTabProps> = ({ design, model, issues, selectedPropertyId, onSelectProperty, onJumpToModel }) => {
  const { t } = useTranslation()

  // Inherited properties are secondary context — collapsed by default so the
  // model's own properties lead. The pane sizes to its content when expanded.
  const [inheritedCollapsed, setInheritedCollapsed] = useState(true)

  const propertyIssueCodes = useCallback((propertyId: string) =>
    issues.filter((issue) => issue.path.includes(propertyId)).map((issue) => issue.code), [issues])

  const commitProperties = useCallback((next: DesignProperty[]) => {
    replaceModel(design, model.id, { ...model, properties: next })
  }, [design, model])

  const updateProperty = useCallback((propertyId: string, update: (p: DesignProperty) => DesignProperty) => {
    commitProperties(model.properties.map((p) => (p.id === propertyId ? pruneProperty(update(p)) : p)))
  }, [commitProperties, model.properties])

  const addProperty = useCallback(() => {
    const fresh: DesignProperty = {
      id: generateUniqueId(),
      doc: { name: '', type: 'string', required: false }
    }
    commitProperties([...model.properties, fresh])
    onSelectProperty(fresh.id)
  }, [commitProperties, model.properties, onSelectProperty])

  const deleteProperty = useCallback((propertyId: string) => {
    // The property's dependents go WITH it: route parameter links that
    // point at it (a dangling link would silently re-bind a later
    // CRUD generation) and the model identifier if it was this one.
    const properties = model.properties.filter((p) => p.id !== propertyId)
    let nextModel: DesignModel = { ...model, properties }
    if (model.design?.identifier?.propertyId === propertyId) {
      const { identifier: _dropped, ...designRest } = model.design
      const { design: _oldDesign, ...modelRest } = nextModel
      nextModel = Object.keys(designRest).length > 0 ? { ...modelRest, design: designRest } : modelRest
    }
    replaceModel(design, model.id, nextModel)
    const routeGroups = design.routeGroups.map((group) => ({
      ...group,
      routes: group.routes.map((route) => {
        const links = route.design?.paramLinks
        if (links === undefined) return route
        const keptEntries = Object.entries(links).filter(([, link]) => link.propertyId !== propertyId)
        if (keptEntries.length === Object.keys(links).length) return route
        const { paramLinks: _droppedLinks, ...designRest } = route.design ?? {}
        const nextDesign = keptEntries.length > 0 ? { ...designRest, paramLinks: Object.fromEntries(keptEntries) } : designRest
        const { design: _oldRouteDesign, ...routeRest } = route
        return Object.keys(nextDesign).length > 0 ? { ...routeRest, design: nextDesign } : routeRest
      })
    }))
    if (routeGroups.some((group, i) => group.routes.some((route, j) => route !== design.routeGroups[i]?.routes[j]))) {
      assignDesignSection(design, 'routeGroups', routeGroups)
    }
    if (selectedPropertyId === propertyId) onSelectProperty(null)
  }, [design, model, selectedPropertyId, onSelectProperty])

  // Inherited properties, walked up the (cycle-tolerant) chain.
  const inherited = useMemo(() => {
    const rows: { parent: DesignModel; property: DesignProperty }[] = []
    const visited = new Set<string>([model.id])
    let parentId = model.design?.inheritsFrom
    while (parentId !== undefined && !visited.has(parentId)) {
      visited.add(parentId)
      const parent = design.models.find((m) => m.id === parentId)
      if (parent === undefined) break
      for (const property of parent.properties) rows.push({ parent, property })
      parentId = parent.design?.inheritsFrom
    }
    return rows
  }, [design.models, model])

  const typeLabel = useCallback((property: DesignProperty): string => {
    const choice = typeChoiceOf(property)
    if (choice.kind === 'model' || choice.kind === 'enum') {
      const target = choice.kind === 'model'
        ? design.models.find((m) => m.id === choice.id)?.doc.name
        : design.enums.find((e) => e.id === choice.id)?.doc.name
      const prefix = choice.kind === 'model' ? t('design.schema.typeModel', 'model') : t('design.schema.typeEnum', 'enum')
      return `${prefix} → ${target ?? '?'}`
    }
    if (choice.kind === 'array') {
      const reference = property.design?.reference
      if (reference !== undefined) {
        const target = design.models.find((m) => m.id === reference.refId)?.doc.name
          ?? design.enums.find((e) => e.id === reference.refId)?.doc.name
        return `array<${target ?? '?'}>`
      }
      return `array<${property.design?.arrayItems?.type ?? 'string'}>`
    }
    if (choice.kind === 'map') return `map<${property.design?.mapValues?.type ?? 'string'}>`
    return property.doc.type
  }, [design, t])

  interface Row { property: DesignProperty; inheritedFrom?: DesignModel }
  // Two distinct groups: inherited rows are read-only and NEVER reorderable
  // (a separate table with no drag handle), own rows reorder among themselves.
  // Keeping them in separate tables also stops an own row being dropped into
  // the inherited block.
  const inheritedRows: Row[] = useMemo(
    () => inherited.map(({ parent, property }) => ({ property, inheritedFrom: parent })),
    [inherited]
  )
  const ownRows: Row[] = useMemo(
    () => model.properties.map((property) => ({ property })),
    [model.properties]
  )

  const flagBadges = useCallback((property: DesignProperty): string[] => {
    const badges: string[] = []
    if (property.doc.required) badges.push(t('design.flags.required', 'required'))
    if (property.doc.nullable === true) badges.push(t('design.flags.nullable', 'nullable'))
    if (property.design?.unique === true) badges.push(t('design.flags.unique', 'unique'))
    if (property.doc.readOnly === true) badges.push(t('design.flags.readOnly', 'readOnly'))
    if (property.design?.writeOnly === true) badges.push(t('design.flags.writeOnly', 'writeOnly'))
    if (property.design?.immutable === true) badges.push(t('design.flags.immutable', 'immutable'))
    if (property.intents?.pii === true) badges.push(t('design.flags.pii', 'PII'))
    if (property.design?.searchable === true) badges.push(t('design.flags.searchable', 'searchable'))
    if (property.doc.deprecated === true) badges.push(t('design.flags.deprecated', 'deprecated'))
    return badges
  }, [t])

  const cell = useCallback((row: Row, content: React.ReactNode, extraClass = ''): React.ReactNode => {
    const propertyId = row.property.id
    const isInherited = row.inheritedFrom !== undefined
    const hasIssue = !isInherited && propertyIssueCodes(propertyId).length > 0
    const classes = [
      'design-prop-cell',
      extraClass,
      isInherited ? 'inherited' : '',
      !isInherited && selectedPropertyId === propertyId ? 'selected' : '',
      hasIssue ? 'has-issue' : ''
    ].filter(Boolean).join(' ')
    return (
      <div
        className={classes}
        onClick={() => { if (!isInherited) onSelectProperty(propertyId) }}
        data-testid={`design-prop-cell-${propertyId}`}
      >
        {content}
      </div>
    )
  }, [propertyIssueCodes, selectedPropertyId, onSelectProperty])

  const columns: TableColumn<Row>[] = useMemo(() => [
    {
      id: 'name',
      header: t('design.schema.columns.property', 'Property'),
      autoWidth: false,
      defaultWidth: 200,
      renderCell: (row) => {
        const name = row.property.doc.name
        const nameNode = name === ''
          ? <span className="design-prop-missing-name">⚠ {t('design.schema.unnamed', '(unnamed)')}</span>
          : <span>{name}</span>
        if (row.inheritedFrom !== undefined) {
          const parent = row.inheritedFrom
          return cell(row, (
            <span className="design-prop-inherited-name">
              {nameNode}
              <HeaderHoverTooltip label={t('design.schema.jumpToParent', 'Open {{name}}', { name: parent.doc.name })}>
                <button
                  type="button"
                  className="design-prop-jump"
                  aria-label={t('design.schema.jumpToParent', 'Open {{name}}', { name: parent.doc.name })}
                  onClick={(e) => { e.stopPropagation(); onJumpToModel(parent.id) }}
                  data-testid={`design-prop-jump-${row.property.id}`}
                >
                  <span className="codicon codicon-arrow-up-right" />
                </button>
              </HeaderHoverTooltip>
            </span>
          ))
        }
        return cell(row, nameNode)
      }
    },
    {
      id: 'type',
      header: t('design.schema.columns.type', 'Type'),
      autoWidth: false,
      defaultWidth: 170,
      renderCell: (row) => cell(row, <span className="design-prop-type">{typeLabel(row.property)}{row.property.doc.format !== undefined && typeChoiceOf(row.property).kind === 'primitive' ? <span className="design-prop-format"> {row.property.doc.format}</span> : null}</span>)
    },
    {
      id: 'flags',
      header: t('design.schema.columns.flags', 'Flags'),
      renderCell: (row) => cell(row, (
        <span className="design-prop-flags">
          {flagBadges(row.property).map((badge) => (
            <span key={badge} className="design-flag-badge">{badge}</span>
          ))}
        </span>
      ))
    },
    {
      id: 'example',
      header: t('design.schema.columns.example', 'Example'),
      autoWidth: false,
      defaultWidth: 160,
      renderCell: (row) => {
        const name = row.property.doc.name
        if (name === '' && row.inheritedFrom === undefined) {
          return cell(row, <span className="design-prop-missing-name">{t('design.schema.nameMissing', 'name missing')}</span>)
        }
        const example = row.property.doc.example
        return cell(row, <span className="design-prop-example">{example === undefined ? '—' : displayValue(example)}</span>)
      }
    }
  ], [t, cell, typeLabel, flagBadges, onJumpToModel])

  const selected = model.properties.find((p) => p.id === selectedPropertyId) ?? null

  const toggleInherited = useCallback(() => { setInheritedCollapsed((v) => !v) }, [])

  const detailPanel = selected !== null ? (
    <PropertyPanel
      key={selected.id}
      design={design}
      model={model}
      property={selected}
      issueCodes={propertyIssueCodes(selected.id)}
      onUpdate={(update) => { updateProperty(selected.id, update) }}
      onDelete={() => { deleteProperty(selected.id) }}
    />
  ) : null

  return (
    <div className="design-schema-tab" data-testid={`design-model-schema-${model.id}`}>
      <div className="design-schema-layout">
        <ScrollableElement className="design-schema-main">
          <div className="design-schema-panes">
          {inheritedRows.length > 0 && (
            <StaticPane
              className="design-schema-pane design-schema-pane--inherited"
              title={
                <span
                  className="design-schema-pane-toggle"
                  role="button"
                  tabIndex={0}
                  aria-expanded={!inheritedCollapsed}
                  onClick={toggleInherited}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleInherited() }
                  }}
                  data-testid="design-inherited-pane-toggle"
                >
                  <i
                    className={`codicon ${inheritedCollapsed ? 'codicon-chevron-right' : 'codicon-chevron-down'}`}
                    aria-hidden
                  />
                  {t('design.schema.inheritedProperties', 'Inherited properties')}
                </span>
              }
            >
              {!inheritedCollapsed && (
                <Table<Row>
                  columns={columns}
                  rows={inheritedRows}
                  getRowId={(row) => row.property.id}
                  data-testid="design-properties-table-inherited"
                />
              )}
            </StaticPane>
          )}
          <StaticPane
            className="design-schema-pane design-schema-pane--own"
            title={t('design.schema.ownProperties', 'Own properties')}
          >
            <Table<Row>
              columns={columns}
              rows={ownRows}
              getRowId={(row) => row.property.id}
              reorderable
              onRowsReorder={(orderedIds) => {
                // This table holds only own rows, so the ordered ids map straight to
                // the reordered own-property list. The guard is belt-and-braces.
                const ownById = new Map(model.properties.map((p) => [p.id, p]))
                const reordered = orderedIds
                  .map((id) => ownById.get(id))
                  .filter((p): p is DesignProperty => p !== undefined)
                if (reordered.length === model.properties.length) commitProperties(reordered)
              }}
              data-testid="design-properties-table"
            />
            <Button
              icon="add"
              secondary
              onClick={addProperty}
              data-testid="design-add-property"
            >
              {t('design.schema.addProperty', 'Add a property')}
            </Button>
            {model.design?.timestamps === true && (
              <div className="design-generated-props" data-testid="design-generated-props">
                <h4 className="design-settings-group-title">{t('design.schema.generatedProperties', 'Generated properties')}</h4>
                {['createdAt', 'updatedAt'].map((name) => (
                  <div key={name} className="design-generated-prop">
                    <span className="design-generated-prop-name">{name}</span>
                    <span className="design-prop-type">date-time</span>
                    <span className="design-flag-badge">{t('design.flags.readOnly', 'readOnly')}</span>
                  </div>
                ))}
              </div>
            )}
          </StaticPane>
          </div>
        </ScrollableElement>
        {detailPanel !== null && (
          <div className="design-schema-detail" data-testid="design-schema-detail">
            <ScrollableElement className="design-schema-detail-scroll">
              {detailPanel}
            </ScrollableElement>
          </div>
        )}
      </div>
    </div>
  )
}

interface PropertyPanelProps {
  design: ApiDesign
  model: DesignModel
  property: DesignProperty
  issueCodes: readonly string[]
  onUpdate: (update: (p: DesignProperty) => DesignProperty) => void
  onDelete: () => void
}

const PropertyPanel: React.FC<PropertyPanelProps> = ({ design, model, property, issueCodes, onUpdate, onDelete }) => {
  const { t } = useTranslation()
  const [propTab, setPropTab] = useState<'property' | 'codegen'>('property')

  // A freshly added property arrives unnamed and immediately flagged; drop
  // the caret straight into the Name field (like the model-create inline
  // edit) so the user types the name instead of hunting for the flash of
  // error. The panel is keyed by property id, so this mount == a new
  // selection; only steal focus while the name is still empty.
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Only while still unnamed: on mount of a freshly added property the
    // name is '' → focus it; the first keystroke makes it non-empty and
    // this early-returns, so typing never re-steals focus. (The panel is
    // keyed by property id, so a different selection is a fresh mount.)
    if (property.doc.name !== '') return
    const host = panelRef.current?.querySelector('[data-testid="design-property-name"]')
    const input = host instanceof HTMLInputElement || host instanceof HTMLTextAreaElement
      ? host
      : host?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea')
    input?.focus()
  }, [property.doc.name])

  // ── Type vocabulary ────────────────────────────────────────────────
  const typeChoices: TypeChoice[] = useMemo(() => [
    ...PRIMITIVES.map((name) => ({ kind: 'primitive' as const, name })),
    { kind: 'array' as const },
    { kind: 'map' as const },
    ...design.models.map((m) => ({ kind: 'model' as const, id: m.id, name: m.doc.name })),
    ...design.enums.map((e) => ({ kind: 'enum' as const, id: e.id, name: e.doc.name }))
  ], [design.models, design.enums])

  const choiceLabel = useCallback((choice: TypeChoice): string => {
    if (choice.kind === 'primitive') return choice.name
    if (choice.kind === 'array') return 'array'
    if (choice.kind === 'map') return 'map'
    const suffix = choice.kind === 'model' ? t('design.schema.typeModel', 'model') : t('design.schema.typeEnum', 'enum')
    return `${choice.name} (${suffix})`
  }, [t])

  const currentChoiceIndex = useMemo(() => {
    const current = typeChoiceOf(property)
    return Math.max(0, typeChoices.findIndex((choice) => {
      if (choice.kind !== current.kind) return false
      if (choice.kind === 'primitive' && current.kind === 'primitive') return choice.name === current.name
      if ((choice.kind === 'model' || choice.kind === 'enum') && (current.kind === 'model' || current.kind === 'enum')) {
        return choice.id === current.id
      }
      return true
    }))
  }, [typeChoices, property])

  const applyTypeChoice = useCallback((choice: TypeChoice) => {
    onUpdate((p) => {
      const { reference: _r, arrayItems: _a, mapValues: _m, ...designRest } = p.design ?? {}
      const { targetModelRef: _t, isArrayOfRef: _i, enumValues: _e, format, ...docRest } = p.doc
      if (choice.kind === 'primitive') {
        return rebuiltProperty(
          p,
          { ...docRest, type: choice.name, ...(choice.name === 'string' && format !== undefined ? { format } : {}) },
          p.intents,
          designRest
        )
      }
      if (choice.kind === 'array') {
        return {
          ...p,
          doc: { ...docRest, type: 'array' },
          design: { ...designRest, arrayItems: { type: 'string' } }
        }
      }
      if (choice.kind === 'map') {
        return {
          ...p,
          doc: { ...docRest, type: 'map' },
          design: { ...designRest, mapValues: { type: 'string' } }
        }
      }
      // Fixture / importer convention: a model reference spells the model
      // name as its doc type, an enum reference stays a documented string.
      return {
        ...p,
        doc: { ...docRest, type: choice.kind === 'model' ? choice.name : 'string' },
        design: { ...designRest, reference: { target: choice.kind, refId: choice.id } }
      }
    })
  }, [onUpdate])

  // Array element type (primitives + models + enums).
  const elementChoices: TypeChoice[] = useMemo(() => [
    ...PRIMITIVES.map((name) => ({ kind: 'primitive' as const, name })),
    ...design.models.map((m) => ({ kind: 'model' as const, id: m.id, name: m.doc.name })),
    ...design.enums.map((e) => ({ kind: 'enum' as const, id: e.id, name: e.doc.name }))
  ], [design.models, design.enums])

  const currentElementIndex = useMemo(() => {
    const reference = property.design?.reference
    if (reference !== undefined) {
      return Math.max(0, elementChoices.findIndex((c) => (c.kind === 'model' || c.kind === 'enum') && c.id === reference.refId))
    }
    const itemType = property.design?.arrayItems?.type ?? 'string'
    return Math.max(0, elementChoices.findIndex((c) => c.kind === 'primitive' && c.name === itemType))
  }, [elementChoices, property])

  const applyElementChoice = useCallback((choice: TypeChoice) => {
    onUpdate((p) => {
      const { reference: _r, arrayItems: _a, ...designRest } = p.design ?? {}
      const { targetModelRef: _t, isArrayOfRef: _i, ...docRest } = p.doc
      if (choice.kind === 'primitive') {
        return { ...p, doc: { ...docRest, type: 'array' }, design: { ...designRest, arrayItems: { type: choice.name } } }
      }
      if (choice.kind === 'model' || choice.kind === 'enum') {
        return {
          ...p,
          doc: { ...docRest, type: 'array', isArrayOfRef: true },
          design: { ...designRest, reference: { target: choice.kind, refId: choice.id } }
        }
      }
      return p
    })
  }, [onUpdate])

  const choice = typeChoiceOf(property)
  const isString = choice.kind === 'primitive' && property.doc.type === 'string'
  const isNumeric = choice.kind === 'primitive' && (property.doc.type === 'integer' || property.doc.type === 'number')
  const isModelRef = property.design?.reference?.target === 'model'
  // A plain string/number scalar can carry an INLINE enum (anonymous allowed
  // set) — the same shape the spec importers keep on `doc.enumValues`. A ref
  // (model/enum), array, map or boolean cannot.
  const canInlineEnum = choice.kind === 'primitive' && (isString || isNumeric)
  const inlineEnumValues = property.doc.enumValues ?? []

  const setInlineEnumValues = useCallback((values: unknown[]) => {
    onUpdate((p) => {
      const { enumValues: _dropped, ...docRest } = p.doc
      return { ...p, doc: values.length > 0 ? { ...docRest, enumValues: values } : docRest }
    })
  }, [onUpdate])

  // Promote an inline enum to a first-class named entity: reuse an existing
  // enum with the IDENTICAL value set (dedup) or mint one named after the
  // model+property, then rewrite the property to reference it and drop the
  // inline values. Mirrors the enum-reference write in `applyTypeChoice`.
  const extractToEnum = useCallback(() => {
    const values = property.doc.enumValues ?? []
    if (values.length === 0) return
    const sameValues = (a: unknown[], b: unknown[]): boolean =>
      a.length === b.length && a.every((v, i) => String(v) === String(b[i]))
    const existing = design.enums.find((e) => sameValues(e.doc.enumValues ?? [], values))
    let refId: string
    if (existing !== undefined) {
      refId = existing.id
    } else {
      refId = generateUniqueId()
      const seed = `${pascalCase(model.doc.name)}${pascalCase(property.doc.name)}` || 'Enum'
      const name = uniqueComponentName(design, seed)
      assignDesignSection(design, 'enums', [...design.enums, { id: refId, doc: { name, properties: [], enumValues: values } }])
    }
    onUpdate((p) => {
      const { enumValues: _e, targetModelRef: _t, ...docRest } = p.doc
      return { ...p, doc: { ...docRest, type: 'string' }, design: { ...(p.design ?? {}), reference: { target: 'enum', refId } } }
    })
  }, [design, model, property, onUpdate])

  const patchConstraints = useCallback((patch: Record<string, number | string | undefined>) => {
    onUpdate((p) => {
      const merged: Record<string, unknown> = { ...(p.doc.constraints ?? {}) }
      const constraints: Record<string, unknown> = {}
      for (const [key, value] of Object.entries({ ...merged, ...patch })) {
        if (value !== undefined && value !== '') constraints[key] = value
      }
      const { constraints: _dropped, ...docRest } = p.doc
      const doc = Object.keys(constraints).length > 0
        ? { ...docRest, constraints: constraints as NonNullable<DesignProperty['doc']['constraints']> }
        : docRest
      return { ...p, doc }
    })
  }, [onUpdate])

  const numberOrUndefined = (value: string): number | undefined => {
    if (value.trim() === '') return undefined
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  const patternValidator = useCallback((value: string): IMessage | null => {
    if (value === '') return null
    try {
      new RegExp(value)
      return null
    } catch {
      return { content: t('design.schema.invalidPattern', 'Invalid regular expression'), type: MessageType.ERROR }
    }
  }, [t])

  const minMaxValidator = useCallback((other: () => number | undefined, isMin: boolean) => (value: string): IMessage | null => {
    const parsed = numberOrUndefined(value)
    const otherValue = other()
    if (parsed !== undefined && otherValue !== undefined && (isMin ? parsed > otherValue : parsed < otherValue)) {
      return { content: t('design.schema.minAboveMax', 'Min exceeds max'), type: MessageType.ERROR }
    }
    return null
  }, [t])

  const flagLabels: Record<string, string> = {
    required: t('design.flags.required', 'required'),
    nullable: t('design.flags.nullable', 'nullable'),
    unique: t('design.flags.unique', 'unique'),
    readOnly: t('design.flags.readOnly', 'readOnly'),
    writeOnly: t('design.flags.writeOnly', 'writeOnly'),
    immutable: t('design.flags.immutable', 'immutable'),
    pii: t('design.flags.pii', 'PII'),
    searchable: t('design.flags.searchable', 'searchable'),
    deprecated: t('design.flags.deprecated', 'deprecated')
  }

  return (
    <div className="design-property-panel" ref={panelRef} data-testid={`design-property-panel-${property.id}`}>
      <div className="design-property-panel-header">
        <h4 className="design-property-panel-title">
          {t('design.schema.panelTitle', 'Property: {{name}}', { name: property.doc.name === '' ? t('design.schema.unnamed', '(unnamed)') : property.doc.name })}
        </h4>
        {(
          <HeaderHoverTooltip label={t('design.schema.deleteProperty', 'Delete the property')}>
            <Button
              secondary
              small
              icon="trash"
              options={{ ariaLabel: t('design.schema.deleteProperty', 'Delete the property') }}
              onClick={onDelete}
              data-testid="design-property-delete"
            />
          </HeaderHoverTooltip>
        )}
      </div>
      {issueCodes.length > 0 && (
        <div className="design-property-issues" data-testid="design-property-issues">
          {issueCodes.map((code) => (
            <span key={code} className="design-property-issue">{t(`design.issue.${code}`, code)}</span>
          ))}
        </div>
      )}

      <div className="design-property-tabs" role="tablist" data-testid="design-property-tabs">
        <button
          type="button"
          role="tab"
          aria-selected={propTab === 'property'}
          className={`design-property-tab${propTab === 'property' ? ' is-active' : ''}`}
          onClick={() => { setPropTab('property') }}
          data-testid="design-property-tab-property"
        >
          {t('design.schema.tabs.property', 'Property')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={propTab === 'codegen'}
          className={`design-property-tab${propTab === 'codegen' ? ' is-active' : ''}`}
          onClick={() => { setPropTab('codegen') }}
          data-testid="design-property-tab-codegen"
        >
          {t('design.codegen.vars.tab', 'Code generation')}
        </button>
      </div>
      {propTab === 'property' && (
        <>
      <div className="design-settings-grid design-property-grid">
        <label className="design-field">
          <span className="design-field-label">{t('design.schema.fields.name', 'Name')}</span>
          <InputBox
            value={property.doc.name}
            onChange={(value) => { onUpdate((p) => ({ ...p, doc: { ...p.doc, name: value } })) }}
            options={{ type: 'text', ariaLabel: t('design.schema.fields.name', 'Name') }}
            data-testid="design-property-name"
          />
        </label>
        <label className="design-field">
          <span className="design-field-label">{t('design.schema.fields.type', 'Type')}</span>
          <SelectBox
            id={`design-property-type-${property.id}`}
            className=""
            options={typeChoices.map((c) => ({ text: choiceLabel(c) }))}
            selected={currentChoiceIndex}
            onDidSelect={(data: ISelectData) => {
              // By INDEX: labels embed model/enum names, which can collide.
              const picked = typeChoices[data.index]
              if (picked !== undefined) applyTypeChoice(picked)
            }}
            selectBoxOptions={{ ariaLabel: t('design.schema.fields.type', 'Type'), useCustomDrawn: true }}
            data-testid="design-property-type"
          />
        </label>
        {isString && (
          <label className="design-field">
            <span className="design-field-label">{t('design.schema.fields.format', 'Format')}</span>
            <SelectBox
              id={`design-property-format-${property.id}`}
              className=""
              options={STRING_FORMATS.map((f) => ({ text: f === '' ? t('design.schema.noFormat', '(none)') : f }))}
              selected={Math.max(0, STRING_FORMATS.indexOf((property.doc.format ?? '') as typeof STRING_FORMATS[number]))}
              onDidSelect={(data: ISelectData) => {
                const picked = STRING_FORMATS.find((f) => (f === '' ? t('design.schema.noFormat', '(none)') : f) === data.selected) ?? ''
                onUpdate((p) => {
                  const { format: _dropped, ...docRest } = p.doc
                  return { ...p, doc: picked === '' ? docRest : { ...docRest, format: picked } }
                })
              }}
              selectBoxOptions={{ ariaLabel: t('design.schema.fields.format', 'Format'), useCustomDrawn: true }}
              data-testid="design-property-format"
            />
          </label>
        )}
        {canInlineEnum && (
          <div className="design-field design-field-full">
            <span className="design-field-label">{t('design.enum.inlineLabel', 'Enum values')}</span>
            <div className="design-enum-inline-row">
              <DesignEnumValuesEditor
                values={inlineEnumValues}
                onChange={setInlineEnumValues}
                parseValue={(raw) => parseTypedValue(property, raw)}
                data-testid="design-property-enum-values"
              />
              {inlineEnumValues.length > 0 && (
                <HeaderHoverTooltip label={t('design.enum.extract', 'Extract to a named enum')}>
                  <Button
                    secondary
                    small
                    icon="export"
                    options={{ ariaLabel: t('design.enum.extract', 'Extract to a named enum') }}
                    onClick={extractToEnum}
                    data-testid="design-property-enum-extract"
                  />
                </HeaderHoverTooltip>
              )}
            </div>
          </div>
        )}
        {choice.kind === 'array' && (
          <label className="design-field">
            <span className="design-field-label">{t('design.schema.fields.elementType', 'Element type')}</span>
            <SelectBox
              id={`design-property-element-${property.id}`}
              className=""
              options={elementChoices.map((c) => ({ text: choiceLabel(c) }))}
              selected={currentElementIndex}
              onDidSelect={(data: ISelectData) => {
                // By INDEX — same collision risk as the type dropdown.
                const picked = elementChoices[data.index]
                if (picked !== undefined) applyElementChoice(picked)
              }}
              selectBoxOptions={{ ariaLabel: t('design.schema.fields.elementType', 'Element type'), useCustomDrawn: true }}
              data-testid="design-property-element-type"
            />
          </label>
        )}
        {isModelRef && (
          <label className="design-field">
            <span className="design-field-label">{t('design.schema.fields.onDelete', 'On delete')}</span>
            <SelectBox
              id={`design-property-ondelete-${property.id}`}
              className=""
              options={ON_DELETE.map((k) => ({ text: t(`design.onDelete.${k}`, k) }))}
              selected={Math.max(0, ON_DELETE.indexOf(property.design?.reference?.onDelete ?? 'restrict'))}
              onDidSelect={(data: ISelectData) => {
                const picked = ON_DELETE.find((k) => t(`design.onDelete.${k}`, k) === data.selected) ?? 'restrict'
                onUpdate((p) => {
                  const reference = p.design?.reference
                  if (reference === undefined) return p
                  return { ...p, design: { ...p.design, reference: { ...reference, onDelete: picked } } }
                })
              }}
              selectBoxOptions={{ ariaLabel: t('design.schema.fields.onDelete', 'On delete'), useCustomDrawn: true }}
              data-testid="design-property-ondelete"
            />
          </label>
        )}
        <label className="design-field design-field-full">
          <span className="design-field-label">{t('design.schema.fields.description', 'Description')}</span>
          <InputBox
            value={property.doc.description ?? ''}
            onChange={(value) => {
              onUpdate((p) => {
                const { description: _dropped, ...docRest } = p.doc
                return { ...p, doc: value === '' ? docRest : { ...docRest, description: value } }
              })
            }}
            options={{ type: 'text', flexibleHeight: true, ariaLabel: t('design.schema.fields.description', 'Description') }}
            data-testid="design-property-description"
          />
        </label>
        <label className="design-field">
          <span className="design-field-label">{t('design.schema.fields.example', 'Example')}</span>
          <InputBox
            value={displayValue(property.doc.example)}
            onChange={(value) => {
              onUpdate((p) => {
                const { example: _dropped, ...docRest } = p.doc
                // Same typed-value door as the examples tab — an integer
                // property must store 42, never "42".
                return { ...p, doc: value === '' ? docRest : { ...docRest, example: parseTypedValue(p, value) } }
              })
            }}
            options={{ type: 'text', ariaLabel: t('design.schema.fields.example', 'Example') }}
            data-testid="design-property-example"
          />
        </label>
      </div>

      <div className="design-property-flags-row" data-testid="design-property-flags">
        {PROPERTY_FLAGS.map((flag) => (
          <label key={flag.key} className="design-flag-toggle">
            <span className="design-field-label">{flagLabels[flag.key]}</span>
            <Toggle
              checked={flag.get(property)}
              onChange={(checked) => { onUpdate((p) => flag.set(p, checked)) }}
              aria-label={flagLabels[flag.key] ?? flag.key}
              data-testid={`design-flag-${flag.key}`}
            />
          </label>
        ))}
      </div>
      {property.doc.deprecated === true && (
        <label className="design-field design-field-full">
          <span className="design-field-label">{t('design.schema.fields.deprecationMessage', 'Deprecation message')}</span>
          <InputBox
            value={property.design?.deprecationMessage ?? ''}
            onChange={(value) => {
              onUpdate((p) => {
                const { deprecationMessage: _dropped, ...rest } = p.design ?? {}
                const design = value === '' ? rest : { ...rest, deprecationMessage: value }
                return rebuiltProperty(p, p.doc, p.intents, design)
              })
            }}
            options={{ type: 'text', ariaLabel: t('design.schema.fields.deprecationMessage', 'Deprecation message') }}
            data-testid="design-property-deprecation-message"
          />
        </label>
      )}

      <div className="design-settings-grid design-property-grid">
        {isString && (
          <>
            <label className="design-field">
              <span className="design-field-label">{t('design.schema.fields.minLength', 'Min length')}</span>
              <InputBox
                value={property.doc.constraints?.minLength === undefined ? '' : String(property.doc.constraints.minLength)}
                onChange={(value) => { patchConstraints({ minLength: numberOrUndefined(value) }) }}
                options={{ type: 'number', ariaLabel: t('design.schema.fields.minLength', 'Min length'), validationOptions: { validation: minMaxValidator(() => property.doc.constraints?.maxLength, true) } }}
                data-testid="design-property-min-length"
              />
            </label>
            <label className="design-field">
              <span className="design-field-label">{t('design.schema.fields.maxLength', 'Max length')}</span>
              <InputBox
                value={property.doc.constraints?.maxLength === undefined ? '' : String(property.doc.constraints.maxLength)}
                onChange={(value) => { patchConstraints({ maxLength: numberOrUndefined(value) }) }}
                options={{ type: 'number', ariaLabel: t('design.schema.fields.maxLength', 'Max length'), validationOptions: { validation: minMaxValidator(() => property.doc.constraints?.minLength, false) } }}
                data-testid="design-property-max-length"
              />
            </label>
            <label className="design-field">
              <span className="design-field-label">{t('design.schema.fields.pattern', 'Pattern')}</span>
              <InputBox
                value={property.doc.constraints?.pattern ?? ''}
                onChange={(value) => { patchConstraints({ pattern: value === '' ? undefined : value }) }}
                options={{ type: 'text', ariaLabel: t('design.schema.fields.pattern', 'Pattern'), validationOptions: { validation: patternValidator } }}
                data-testid="design-property-pattern"
              />
            </label>
          </>
        )}
        {isNumeric && (
          <>
            <label className="design-field">
              <span className="design-field-label">{t('design.schema.fields.minimum', 'Minimum')}</span>
              <InputBox
                value={property.doc.constraints?.minimum === undefined ? '' : String(property.doc.constraints.minimum)}
                onChange={(value) => { patchConstraints({ minimum: numberOrUndefined(value) }) }}
                options={{ type: 'number', ariaLabel: t('design.schema.fields.minimum', 'Minimum'), validationOptions: { validation: minMaxValidator(() => property.doc.constraints?.maximum, true) } }}
                data-testid="design-property-minimum"
              />
            </label>
            <label className="design-field">
              <span className="design-field-label">{t('design.schema.fields.maximum', 'Maximum')}</span>
              <InputBox
                value={property.doc.constraints?.maximum === undefined ? '' : String(property.doc.constraints.maximum)}
                onChange={(value) => { patchConstraints({ maximum: numberOrUndefined(value) }) }}
                options={{ type: 'number', ariaLabel: t('design.schema.fields.maximum', 'Maximum'), validationOptions: { validation: minMaxValidator(() => property.doc.constraints?.minimum, false) } }}
                data-testid="design-property-maximum"
              />
            </label>
          </>
        )}
        <label className="design-field">
          <span className="design-field-label">{t('design.schema.fields.default', 'Default')}</span>
          <InputBox
            value={displayValue(property.design?.defaultValue)}
            onChange={(value) => {
              onUpdate((p) => {
                const { defaultValue: _dropped, ...rest } = p.design ?? {}
                // Typed like doc.example — an integer default stores 3, not "3".
                const design = value === '' ? rest : { ...rest, defaultValue: parseTypedValue(p, value) }
                return rebuiltProperty(p, p.doc, p.intents, design)
              })
            }}
            options={{ type: 'text', ariaLabel: t('design.schema.fields.default', 'Default') }}
            data-testid="design-property-default"
          />
        </label>
      </div>
        </>
      )}
      {propTab === 'codegen' && (
        <DesignPropertyCodegenTab design={design} model={model} property={property} />
      )}
    </div>
  )
}
