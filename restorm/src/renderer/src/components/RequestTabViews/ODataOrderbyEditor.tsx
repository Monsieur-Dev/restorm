/**
 * ODataOrderbyEditor — structured builder for `$orderby`.
 *
 * Parses the raw orderby clause (`Name asc, Id desc`) into a list of
 * {property, direction} pairs, renders each as an InputBox + SelectBox
 * row with add/remove/reorder controls, and emits a canonical
 * comma-separated clause back through `onChange` on every edit.
 *
 * Env / handlebars templates (e.g. `{{sortField}} asc`) round-trip as
 * the property name — the URL resolver resolves them at send time.
 */

import React, { type CSSProperties, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  InputBox,
  MultiSelectCombo,
  SelectBox,
  type ISelectData,
  type ISelectOptionItem
} from 'electron-core-ui/renderer'

type Direction = 'asc' | 'desc'

export interface OrderbyClauseSpec {
  id: string
  property: string
  direction: Direction
}

const DIRECTIONS: Direction[] = ['asc', 'desc']

const rowStyle: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center' }
const propertyWrapperStyle: CSSProperties = { flex: 1, minWidth: 150 }
const propertyPickerWrapperStyle: CSSProperties = { width: 130, minWidth: 0 }
const directionWrapperStyle: CSSProperties = { width: 100 }
const buttonRowStyle: CSSProperties = { display: 'flex', gap: 4 }
const labelStyle: CSSProperties = { fontSize: 12, color: 'var(--descriptionForeground)' }

function parseOrderby(clause: string | undefined): OrderbyClauseSpec[] {
  if (!clause) return []
  const out: OrderbyClauseSpec[] = []
  for (const segment of clause.split(',')) {
    const trimmed = segment.trim()
    if (!trimmed) continue
    const parts = trimmed.split(/\s+/)
    const property = parts[0] ?? ''
    const directionRaw = (parts[1] ?? 'asc').toLowerCase()
    const direction: Direction = directionRaw === 'desc' ? 'desc' : 'asc'
    out.push({ id: crypto.randomUUID(), property, direction })
  }
  return out
}

function serializeOrderby(specs: readonly OrderbyClauseSpec[]): string {
  return specs
    .filter((s) => s.property.trim() !== '')
    .map((s) => `${s.property} ${s.direction}`)
    .join(',')
}

export interface ODataOrderbyEditorProps {
  value: string | undefined
  onChange: (next: string) => void
  /** Bound entity-type property names (from the importer). When
   * present, each row gains a property picker that fills its property
   * field — the metadata-driven autocomplete affordance for $orderby.
   * The free-text input stays so `{{template}}` clauses still work. */
  propertySuggestions?: readonly string[]
}

export const ODataOrderbyEditor: React.FC<ODataOrderbyEditorProps> = ({ value, onChange, propertySuggestions = [] }) => {
  const { t } = useTranslation()
  // The clause SERIALIZES away empty-property rows, so round-tripping through the
  // string `value` would make a freshly-added blank row vanish before the user
  // can type into it. Hold the specs as LOCAL state (the editing source of truth)
  // and only push the serialized form up; re-seed from `value` only when it
  // changes EXTERNALLY (its serialization diverges from what we last emitted).
  const [specs, setSpecs] = React.useState<OrderbyClauseSpec[]>(() => parseOrderby(value))
  // Track the last clause we're in sync with AS STATE (this repo forbids ref
  // access during render + setState in effects). An external `value` change
  // reseeds during render; our own `emit` advances `synced` itself, so an
  // echoed-back serialization that dropped a blank row does NOT reseed.
  const [synced, setSynced] = React.useState<string>(value ?? '')
  if ((value ?? '') !== synced) {
    setSynced(value ?? '')
    setSpecs(parseOrderby(value))
  }
  const directionOptions: ISelectOptionItem[] = DIRECTIONS.map((d) => ({ text: d }))
  const propertyOptions = useMemo(
    () => propertySuggestions
      .slice()
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      .map((name) => ({ value: name, label: name })),
    [propertySuggestions]
  )

  const emit = (next: OrderbyClauseSpec[]): void => {
    setSpecs(next)
    setSynced(serializeOrderby(next))
    onChange(serializeOrderby(next))
  }

  const update = (index: number, patch: Partial<OrderbyClauseSpec>): void => {
    const next = specs.slice()
    const current = next[index]
    if (!current) return
    next[index] = { ...current, ...patch }
    emit(next)
  }

  const remove = (index: number): void => {
    const next = specs.slice()
    next.splice(index, 1)
    emit(next)
  }

  const move = (index: number, delta: number): void => {
    const target = index + delta
    if (target < 0 || target >= specs.length) return
    const next = specs.slice()
    const [item] = next.splice(index, 1)
    if (!item) return
    next.splice(target, 0, item)
    emit(next)
  }

  const add = (): void => {
    emit([...specs, { id: crypto.randomUUID(), property: '', direction: 'asc' }])
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} data-testid="odata-orderby-editor">
      {specs.length === 0 ? (
        <span style={{ ...labelStyle, fontStyle: 'italic' }}>
          {t('odataRequestTab.orderbyEmpty', 'No ordering yet. Add a property below.')}
        </span>
      ) : null}

      {specs.map((spec, index) => (
        <div key={spec.id} style={rowStyle} data-testid={`odata-orderby-row-${index}`}>
          <div style={propertyWrapperStyle}>
            <InputBox
              value={spec.property}
              onChange={(property: string) => { update(index, { property }) }}
              options={{ placeholder: t('odataRequestTab.orderbyPropertyPlaceholder', 'Name') }}
              data-testid={`odata-orderby-property-${index}`}
            />
          </div>
          {propertyOptions.length > 0 ? (
            <div style={propertyPickerWrapperStyle}>
              <MultiSelectCombo
                options={propertyOptions}
                selected={[]}
                onChange={(next: string[]) => {
                  const picked = next[next.length - 1]
                  if (picked) update(index, { property: picked })
                }}
                placeholder={t('odataRequestTab.orderbyPropertyPickerPlaceholder', 'Pick…')}
                data-testid={`odata-orderby-property-picker-${index}`}
              />
            </div>
          ) : null}
          <div style={directionWrapperStyle}>
            <SelectBox
              id={`odata-orderby-direction-${index}`}
              className=""
              options={directionOptions}
              selected={Math.max(0, DIRECTIONS.indexOf(spec.direction))}
              onDidSelect={(data: ISelectData) => {
                const next = DIRECTIONS[data.index]
                if (next) update(index, { direction: next })
              }}
              data-testid={`odata-orderby-direction-${index}`}
            />
          </div>
          <div style={buttonRowStyle}>
            <Button
              icon="chevron-up"
              onClick={() => { move(index, -1) }}
              options={{
                ariaLabel: t('odataRequestTab.orderbyMoveUp', 'Move up'),
                title: t('odataRequestTab.orderbyMoveUp', 'Move up')
              }}
              data-testid={`odata-orderby-move-up-${index}`}
              disabled={index === 0}
            />
            <Button
              icon="chevron-down"
              onClick={() => { move(index, 1) }}
              options={{
                ariaLabel: t('odataRequestTab.orderbyMoveDown', 'Move down'),
                title: t('odataRequestTab.orderbyMoveDown', 'Move down')
              }}
              data-testid={`odata-orderby-move-down-${index}`}
              disabled={index === specs.length - 1}
            />
            <Button
              icon="trash"
              onClick={() => { remove(index) }}
              options={{
                ariaLabel: t('odataRequestTab.orderbyRemove', 'Remove'),
                title: t('odataRequestTab.orderbyRemove', 'Remove')
              }}
              data-testid={`odata-orderby-remove-${index}`}
            />
          </div>
        </div>
      ))}

      <div>
        <Button
          icon="add"
          onClick={add}
          options={{
            ariaLabel: t('odataRequestTab.orderbyAdd', 'Add orderby'),
            title: t('odataRequestTab.orderbyAdd', 'Add orderby')
          }}
          data-testid="odata-orderby-add"
        >
          {t('odataRequestTab.orderbyAdd', 'Add orderby')}
        </Button>
      </div>
    </div>
  )
}
