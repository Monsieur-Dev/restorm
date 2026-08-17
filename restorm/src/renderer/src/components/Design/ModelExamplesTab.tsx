import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { InputBox, MessageType, Table, type IMessage, type TableColumn } from 'electron-core-ui/renderer'
import type { ApiDesign, DesignExample, DesignModel, DesignProperty } from '../../../../shared/types/collections'
import { resolveExampleValue, violatedConstraint } from '../../../../shared/design/designExampleValues'
import { displayValue } from './designDisplay'
import { generateUniqueId } from '../../utils/treeManipulation'
import { replaceModel } from './designMutations'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'

/** The sentinel pill: per-property `doc.example` values, seeded when
 * absent — what a spec export and the design server use when no named
 * example is requested. */
const DEFAULT_PILL = 'default'

export interface ModelExamplesTabProps {
  design: ApiDesign
  model: DesignModel
  editLocked: boolean
}

/**
 * The Exemples tab: a pill per example (the implicit Défaut first),
 * then the value table of the selected example — defined values
 * editable in place, absent ones showing their seeded auto value.
 */
export const ModelExamplesTab: React.FC<ModelExamplesTabProps> = ({ design, model, editLocked }) => {
  const { t } = useTranslation()
  const [selectedId, setSelectedId] = useState<string>(DEFAULT_PILL)

  const examples = model.examples ?? []
  const selected = examples.find((e) => e.id === selectedId)
  const showingDefault = selected === undefined

  // An example describes an INSTANCE, so inherited properties get value
  // rows too — each row remembers which model owns the property (a
  // default-value edit writes into the owner's doc).
  const rows = useMemo(() => {
    const collected: { owner: DesignModel; property: DesignProperty }[] = []
    const visited = new Set<string>()
    let current: DesignModel | undefined = model
    while (current !== undefined && !visited.has(current.id)) {
      visited.add(current.id)
      for (const property of current.properties) collected.push({ owner: current, property })
      const parentId: string | undefined = current.design?.inheritsFrom
      current = parentId === undefined ? undefined : design.models.find((m) => m.id === parentId)
    }
    return collected
  }, [design.models, model])

  const commitExamples = (next: DesignExample[]): void => {
    const { examples: _dropped, ...modelRest } = model
    replaceModel(design, model.id, next.length > 0 ? { ...modelRest, examples: next } : modelRest)
  }

  const addExample = (): void => {
    const taken = new Set(examples.map((e) => e.name))
    let name = t('design.examples.newName', 'Example')
    for (let i = 2; taken.has(name); i++) name = `${t('design.examples.newName', 'Example')} ${i}`
    const fresh: DesignExample = { id: generateUniqueId(), name, values: {} }
    commitExamples([...examples, fresh])
    setSelectedId(fresh.id)
  }

  const deleteExample = (exampleId: string): void => {
    commitExamples(examples.filter((e) => e.id !== exampleId))
    if (selectedId === exampleId) setSelectedId(DEFAULT_PILL)
  }

  const renameExample = (exampleId: string, name: string): void => {
    commitExamples(examples.map((e) => (e.id === exampleId ? { ...e, name } : e)))
  }

  /** Parse a typed-in value according to the property's declared type,
   * so numbers and booleans round-trip as their real JSON type. */
  const parseValue = (property: DesignProperty, raw: string): unknown => {
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
    return raw
  }

  /** The examples editor refuses a defined value the property's own
   * constraints rule out — the field shows the message, nothing is
   * stored until the value conforms. */
  const constraintValidator = (property: DesignProperty) => (raw: string): IMessage | null => {
    if (raw === '') return null
    const violated = violatedConstraint(property, parseValue(property, raw))
    if (violated === null) return null
    return {
      content: t('design.examples.constraintViolated', 'Value violates the property constraint ({{constraint}})', { constraint: violated }),
      type: MessageType.ERROR
    }
  }

  const setDefinedValue = (owner: DesignModel, property: DesignProperty, raw: string): void => {
    if (raw !== '' && violatedConstraint(property, parseValue(property, raw)) !== null) return
    if (showingDefault) {
      const properties = owner.properties.map((p) => {
        if (p.id !== property.id) return p
        const { example: _dropped, ...docRest } = p.doc
        return { ...p, doc: raw === '' ? docRest : { ...docRest, example: parseValue(p, raw) } }
      })
      replaceModel(design, owner.id, { ...owner, properties })
      return
    }
    const values = { ...selected.values }
    if (raw === '') {
      const { [property.id]: _dropped, ...rest } = values
      commitExamples(examples.map((e) => (e.id === selected.id ? { ...e, values: rest } : e)))
      return
    }
    commitExamples(examples.map((e) => (e.id === selected.id ? { ...e, values: { ...values, [property.id]: parseValue(property, raw) } } : e)))
  }

  interface Row { owner: DesignModel; property: DesignProperty }

  const resolveRow = (row: Row): { value: unknown; auto: boolean } => {
    if (selected === undefined) {
      if (row.property.doc.example !== undefined) return { value: row.property.doc.example, auto: false }
      return {
        ...resolveExampleValue(design, model, { id: DEFAULT_PILL, values: {} }, row.property)
      }
    }
    return resolveExampleValue(design, model, selected, row.property)
  }

  const columns: TableColumn<Row>[] = [
    {
      id: 'property',
      header: t('design.schema.columns.property', 'Property'),
      autoWidth: false,
      defaultWidth: 200,
      renderCell: (row) => (
        <span className={row.owner.id === model.id ? 'design-example-prop' : 'design-example-prop inherited'}>
          {row.property.doc.name === '' ? t('design.schema.unnamed', '(unnamed)') : row.property.doc.name}
          {row.owner.id !== model.id && <span className="design-example-prop-owner"> · {row.owner.doc.name}</span>}
        </span>
      )
    },
    {
      id: 'value',
      header: t('design.examples.columns.value', 'Value'),
      renderCell: (row) => {
        const { value, auto } = resolveRow(row)
        return (
          <InputBox
            value={auto ? '' : displayValue(value)}
            onChange={(next) => { setDefinedValue(row.owner, row.property, next) }}
            options={{
              type: 'text',
              placeholder: displayValue(value),
              ariaLabel: row.property.doc.name,
              validationOptions: { validation: constraintValidator(row.property) }
            }}
            disabled={editLocked}
            data-testid={`design-example-value-${row.property.id}`}
          />
        )
      }
    },
    {
      id: 'origin',
      header: t('design.examples.columns.origin', 'Origin'),
      autoWidth: false,
      defaultWidth: 90,
      renderCell: (row) => {
        const { auto } = resolveRow(row)
        return (
          <span className={auto ? 'design-example-origin auto' : 'design-example-origin defined'} data-testid={`design-example-origin-${row.property.id}`}>
            {auto ? t('design.examples.auto', 'auto') : t('design.examples.defined', 'defined')}
          </span>
        )
      }
    }
  ]

  return (
    <div className="design-examples-tab" data-testid={`design-model-examples-${model.id}`}>
      <div className="design-example-pills" role="tablist" data-testid="design-example-pills">
        <button
          type="button"
          className={showingDefault ? 'design-pill active' : 'design-pill'}
          onClick={() => { setSelectedId(DEFAULT_PILL) }}
          data-testid="design-example-pill-default"
        >
          {t('design.examples.defaultPill', 'Default')}
        </button>
        {examples.map((example) => (
          <button
            key={example.id}
            type="button"
            className={selectedId === example.id ? 'design-pill active' : 'design-pill'}
            onClick={() => { setSelectedId(example.id) }}
            data-testid={`design-example-pill-${example.id}`}
          >
            {example.name}
          </button>
        ))}
        {!editLocked && (
          <HeaderHoverTooltip label={t('design.examples.add', 'Add an example')}>
            <button
              type="button"
              className="design-icon-button"
              aria-label={t('design.examples.add', 'Add an example')}
              onClick={addExample}
              data-testid="design-example-add"
            >
              <span className="codicon codicon-add" />
            </button>
          </HeaderHoverTooltip>
        )}
      </div>

      {selected !== undefined && (
        <div className="design-example-header">
          <label className="design-field">
            <span className="design-field-label">{t('design.examples.name', 'Example name')}</span>
            <InputBox
              value={selected.name}
              onChange={(value) => { renameExample(selected.id, value) }}
              options={{ type: 'text', ariaLabel: t('design.examples.name', 'Example name') }}
              disabled={editLocked}
              data-testid="design-example-name"
            />
          </label>
          {!editLocked && (
            <HeaderHoverTooltip label={t('design.examples.delete', 'Delete the example')}>
              <button
                type="button"
                className="design-icon-button"
                aria-label={t('design.examples.delete', 'Delete the example')}
                onClick={() => { deleteExample(selected.id) }}
                data-testid="design-example-delete"
              >
                <span className="codicon codicon-trash" />
              </button>
            </HeaderHoverTooltip>
          )}
        </div>
      )}

      <p className="design-examples-hint">
        {showingDefault
          ? t('design.examples.defaultHint', 'Default values come from each property (empty = generated automatically).')
          : t('design.examples.namedHint', 'Type a value to define it; leave empty to keep the generated one.')}
      </p>

      <Table<Row>
        columns={columns}
        rows={rows}
        getRowId={(row) => row.property.id}
      />
    </div>
  )
}
