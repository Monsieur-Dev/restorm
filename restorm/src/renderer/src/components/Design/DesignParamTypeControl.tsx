import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Modal, SelectBox, type ISelectData } from 'electron-core-ui/renderer'
import type { ParameterDocumentation } from '../../../../shared/types/apiDocumentation'
import type { DesignEnum } from '../../../../shared/types/apiDesign'
import { parseTypedRaw } from './designDisplay'
import { DesignEnumValuesEditor } from './DesignEnumValuesEditor'

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
 * The type control for a route parameter, shared by the path and query/header
 * tables. It stays a single inline combo so picking a plain scalar is ONE
 * click; its options are the primitives, the design's named enums, and a
 * trailing "Advanced…" entry that opens a scoped modal for the richer cases —
 * array + element type, and the inline enum-values editor with "extract to a
 * named enum". When the current type is one of those richer cases the combo
 * shows a compact summary (`string[]`, `string[] · enum ×3`) as its selected
 * label, and re-selecting it reopens the modal. A model-linked param renders
 * its inherited type read-only.
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
  const values = enumRefId === undefined ? (param.enumValues ?? []) : []
  const canInline = enumRefId === undefined && (effectiveScalar === 'string' || effectiveScalar === 'integer' || effectiveScalar === 'number')

  if (inherited !== null) {
    return (
      <span className="design-param-inherited" data-testid={testId}>
        {inherited.type}{inherited.format !== undefined ? ` ${inherited.format}` : ''}
      </span>
    )
  }

  // "Complex" = needs the modal to read/edit (an array, or inline enum values).
  // A plain scalar or a scalar enum-reference is picked straight from the combo.
  const isComplex = isArray || values.length > 0
  const summary = isComplex
    ? `${isArray ? `${element}[]` : param.type}${values.length > 0 ? ` · ${t('design.schema.typeEnum', 'enum')} ×${values.length}` : ''}`
    : ''
  const advancedLabel = t('design.schema.advancedType', 'Advanced…')

  const offset = isComplex ? 1 : 0
  const options = [
    ...(isComplex ? [{ text: summary }] : []),
    ...PARAM_TYPES.map((type) => ({ text: type })),
    ...enums.map((e) => ({ text: `${e.doc.name} (${t('design.schema.typeEnum', 'enum')})` })),
    { text: advancedLabel }
  ]
  const selected = isComplex
    ? 0
    : enumRefId !== undefined
      ? Math.max(0, PARAM_TYPES.length + enums.findIndex((e) => e.id === enumRefId))
      : Math.max(0, PARAM_TYPES.indexOf(param.type as typeof PARAM_TYPES[number]))

  const onCombo = (index: number): void => {
    if (isComplex && index === 0) { setOpen(true); return }
    const adjusted = index - offset
    if (adjusted < PARAM_TYPES.length) onSetType(PARAM_TYPES[adjusted] ?? 'string')
    else if (adjusted < PARAM_TYPES.length + enums.length) {
      const picked = enums[adjusted - PARAM_TYPES.length]
      if (picked !== undefined) onSetEnumRef(picked.id)
    } else setOpen(true) // the trailing "Advanced…" entry
  }

  return (
    <>
      <SelectBox
        id={`${testId}-select`}
        className=""
        options={options}
        selected={selected}
        onDidSelect={(data: ISelectData) => { onCombo(data.index) }}
        selectBoxOptions={{ ariaLabel: t('design.schema.columns.type', 'Type'), useCustomDrawn: true }}
        data-testid={testId}
      />
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
                id={`${testId}-modal-type`}
                className=""
                options={[
                  ...PARAM_TYPES.map((type) => ({ text: type })),
                  { text: 'array' },
                  ...enums.map((e) => ({ text: `${e.doc.name} (${t('design.schema.typeEnum', 'enum')})` }))
                ]}
                selected={enumRefId !== undefined
                  ? Math.max(0, PARAM_TYPES.length + 1 + enums.findIndex((e) => e.id === enumRefId))
                  : isArray
                    ? PARAM_TYPES.length
                    : Math.max(0, PARAM_TYPES.indexOf(param.type as typeof PARAM_TYPES[number]))}
                onDidSelect={(data: ISelectData) => {
                  if (data.index < PARAM_TYPES.length) onSetType(PARAM_TYPES[data.index] ?? 'string')
                  else if (data.index === PARAM_TYPES.length) onSetType(`array<${isArray ? element : 'string'}>`)
                  else {
                    const picked = enums[data.index - PARAM_TYPES.length - 1]
                    if (picked !== undefined) onSetEnumRef(picked.id)
                  }
                }}
                selectBoxOptions={{ ariaLabel: t('design.schema.columns.type', 'Type'), useCustomDrawn: true }}
                data-testid={`${testId}-modal-type-select`}
              />
            </label>
            {isArray && (
              <label className="design-field">
                <span className="design-field-label">{t('design.schema.fields.elementType', 'Element type')}</span>
                <SelectBox
                  id={`${testId}-modal-element`}
                  className=""
                  options={PARAM_TYPES.map((type) => ({ text: type }))}
                  selected={Math.max(0, PARAM_TYPES.indexOf(element as typeof PARAM_TYPES[number]))}
                  onDidSelect={(data: ISelectData) => { onSetType(`array<${PARAM_TYPES[data.index] ?? 'string'}>`) }}
                  selectBoxOptions={{ ariaLabel: t('design.schema.fields.elementType', 'Element type'), useCustomDrawn: true }}
                  data-testid={`${testId}-modal-element-select`}
                />
              </label>
            )}
            {canInline && (
              <label className="design-field design-field-full">
                <span className="design-field-label">{t('design.enum.inlineLabel', 'Enum values')}</span>
                <DesignEnumValuesEditor
                  values={values}
                  onChange={onSetEnumValues}
                  parseValue={(raw) => parseTypedRaw(effectiveScalar, raw)}
                  data-testid={`${testId}-enum-values`}
                />
                {values.length > 0 && (
                  <div className="design-param-type-modal-actions">
                    <Button
                      secondary
                      icon="export"
                      onClick={() => { onExtract(); setOpen(false) }}
                      data-testid={`${testId}-enum-extract`}
                    >
                      {t('design.enum.extract', 'Extract to a named enum')}
                    </Button>
                  </div>
                )}
              </label>
            )}
          </div>
        </Modal>
      )}
    </>
  )
}
