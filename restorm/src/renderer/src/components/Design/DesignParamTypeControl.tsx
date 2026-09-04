import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Modal, SelectBox, type ISelectData } from 'electron-core-ui/renderer'
import type { ParameterDocumentation } from '../../../../shared/types/apiDocumentation'
import type { DesignEnum } from '../../../../shared/types/apiDesign'
import { parseTypedRaw } from './designDisplay'
import { DesignEnumValuesEditor } from './DesignEnumValuesEditor'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'

const PARAM_TYPES = ['string', 'integer', 'number', 'boolean'] as const

export interface DesignParamTypeControlProps {
  param: ParameterDocumentation
  /** The id of a named enum this param references, if any (paramEnumRefs). */
  enumRefId: string | undefined
  /** Inherited type/format when the param is linked to a model property —
   * renders read-only (the link owns the type). */
  inherited: { type: string; format?: string } | null
  enums: DesignEnum[]
  onSetType: (typeString: string) => void
  onSetEnumRef: (enumId: string) => void
  onSetEnumValues: (values: unknown[]) => void
  onExtract: () => void
  'data-testid'?: string
}

/** Parse `array<element>` (or a bare `array`) → its element type. */
function arrayElement(type: string): string | null {
  const m = /^array(?:<(.+)>)?$/.exec(type)
  return m === null ? null : (m[1] ?? 'string')
}

/**
 * The compact type control for a route parameter, shared by the path and
 * query/header tables. In the table it is a single-line SUMMARY chip
 * (`string`, `string[]`, `PetStatus`, `string[] · enum ×3`) so every row cell
 * keeps the same height; clicking it opens a scoped modal that holds the full
 * type configuration — scalar / array + element type / named-enum reference,
 * plus the inline enum-values editor and "extract to a named enum". A
 * model-linked param renders its inherited type read-only (no modal).
 */
export const DesignParamTypeControl: React.FC<DesignParamTypeControlProps> = ({
  param, enumRefId, inherited, enums, onSetType, onSetEnumRef, onSetEnumValues, onExtract, 'data-testid': dataTestId
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const testId = dataTestId ?? 'design-param-type'

  const element = arrayElement(param.type)
  const isArray = element !== null
  const effectiveScalar = isArray ? element : param.type
  const enumEntity = enumRefId !== undefined ? enums.find((e) => e.id === enumRefId) : undefined
  const values = enumRefId === undefined ? (param.enumValues ?? []) : []
  const canInline = enumRefId === undefined && (effectiveScalar === 'string' || effectiveScalar === 'integer' || effectiveScalar === 'number')

  // One-line summary: TypeScript-ish (`string[]`), the enum name for a ref, and
  // a `· enum ×N` suffix when inline values are present.
  const summary = useMemo(() => {
    if (inherited !== null) return `${inherited.type}${inherited.format !== undefined ? ` ${inherited.format}` : ''}`
    const base = enumEntity !== undefined
      ? `${enumEntity.doc.name}${isArray ? '[]' : ''}`
      : isArray ? `${element}[]` : param.type
    return values.length > 0 ? `${base} · ${t('design.schema.typeEnum', 'enum')} ×${values.length}` : base
  }, [inherited, enumEntity, isArray, element, param.type, values.length, t])

  if (inherited !== null) {
    return (
      <span className="design-param-inherited" data-testid={testId}>{summary}</span>
    )
  }

  const ARRAY_INDEX = PARAM_TYPES.length
  const options = [
    ...PARAM_TYPES.map((type) => ({ text: type })),
    { text: 'array' },
    ...enums.map((e) => ({ text: `${e.doc.name} (${t('design.schema.typeEnum', 'enum')})` }))
  ]
  const selectedType = enumRefId !== undefined
    ? Math.max(0, ARRAY_INDEX + 1 + enums.findIndex((e) => e.id === enumRefId))
    : isArray
      ? ARRAY_INDEX
      : Math.max(0, PARAM_TYPES.indexOf(param.type as typeof PARAM_TYPES[number]))

  return (
    <>
      <button
        type="button"
        className="design-param-type-chip"
        onClick={() => { setOpen(true) }}
        data-testid={`${testId}-chip`}
      >
        <span className="design-param-type-chip-label">{summary}</span>
        <span className="codicon codicon-edit design-param-type-chip-edit" aria-hidden="true" />
      </button>
      {open && (
        <Modal
          title={`${t('design.schema.columns.type', 'Type')} — ${param.name}`}
          isOpen
          onClose={() => { setOpen(false) }}
          size="dialog"
          data-testid={`${testId}-modal`}
        >
          <div className="design-param-type-modal">
            <label className="design-field">
              <span className="design-field-label">{t('design.schema.columns.type', 'Type')}</span>
              <SelectBox
                id={`${testId}-type-select`}
                className=""
                options={options}
                selected={selectedType}
                onDidSelect={(data: ISelectData) => {
                  if (data.index < PARAM_TYPES.length) onSetType(PARAM_TYPES[data.index] ?? 'string')
                  else if (data.index === ARRAY_INDEX) onSetType(`array<${isArray ? element : 'string'}>`)
                  else {
                    const picked = enums[data.index - ARRAY_INDEX - 1]
                    if (picked !== undefined) onSetEnumRef(picked.id)
                  }
                }}
                selectBoxOptions={{ ariaLabel: t('design.schema.columns.type', 'Type'), useCustomDrawn: true }}
                data-testid={`${testId}-type`}
              />
            </label>
            {isArray && (
              <label className="design-field">
                <span className="design-field-label">{t('design.schema.fields.elementType', 'Element type')}</span>
                <SelectBox
                  id={`${testId}-element-select`}
                  className=""
                  options={PARAM_TYPES.map((type) => ({ text: type }))}
                  selected={Math.max(0, PARAM_TYPES.indexOf(element as typeof PARAM_TYPES[number]))}
                  onDidSelect={(data: ISelectData) => { onSetType(`array<${PARAM_TYPES[data.index] ?? 'string'}>`) }}
                  selectBoxOptions={{ ariaLabel: t('design.schema.fields.elementType', 'Element type'), useCustomDrawn: true }}
                  data-testid={`${testId}-element`}
                />
              </label>
            )}
            {canInline && (
              <label className="design-field design-field-full">
                <span className="design-field-label">{t('design.enum.inlineLabel', 'Enum values')}</span>
                <div className="design-enum-inline-row">
                  <DesignEnumValuesEditor
                    values={values}
                    onChange={onSetEnumValues}
                    parseValue={(raw) => parseTypedRaw(effectiveScalar, raw)}
                    data-testid={`${testId}-enum-values`}
                  />
                  {values.length > 0 && (
                    <HeaderHoverTooltip label={t('design.enum.extract', 'Extract to a named enum')}>
                      <Button
                        secondary
                        small
                        icon="export"
                        options={{ ariaLabel: t('design.enum.extract', 'Extract to a named enum') }}
                        onClick={() => { onExtract(); setOpen(false) }}
                        data-testid={`${testId}-enum-extract`}
                      />
                    </HeaderHoverTooltip>
                  )}
                </div>
              </label>
            )}
          </div>
        </Modal>
      )}
    </>
  )
}
