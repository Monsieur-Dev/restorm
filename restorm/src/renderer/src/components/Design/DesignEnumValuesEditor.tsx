import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { InputBox } from 'electron-core-ui/renderer'

export interface DesignEnumValuesEditorProps {
  /** Current inline enum values (typed — string / number). */
  values: unknown[]
  /** Commit a new value list (add / remove). */
  onChange: (values: unknown[]) => void
  /** Coerce a typed value to its wire form (integer/number props store 42,
   * not "42"). Defaults to the trimmed string. */
  parseValue?: (raw: string) => unknown
  'data-testid'?: string
}

/**
 * A chip editor for a property's or parameter's INLINE enum values (the
 * allowed set, no named entity). Mirrors the tags editor: existing values are
 * removable chips, a new one is typed and committed on Enter or comma. Blank
 * and duplicate values (compared by their string form) are dropped, and each
 * value is coerced through `parseValue` so a numeric enum keeps real numbers.
 */
export const DesignEnumValuesEditor: React.FC<DesignEnumValuesEditorProps> = ({ values, onChange, parseValue, 'data-testid': dataTestId }) => {
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')
  const testId = dataTestId ?? 'design-enum-values'

  const commit = useCallback((raw: string) => {
    const trimmed = raw.trim()
    if (trimmed === '') { setDraft(''); return }
    const coerced = parseValue !== undefined ? parseValue(trimmed) : trimmed
    if (values.some((v) => String(v) === String(coerced))) { setDraft(''); return }
    onChange([...values, coerced])
    setDraft('')
  }, [values, onChange, parseValue])

  const removeAt = useCallback((index: number) => {
    onChange(values.filter((_, i) => i !== index))
  }, [values, onChange])

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commit(draft)
    } else if (e.key === 'Backspace' && draft === '' && values.length > 0) {
      removeAt(values.length - 1)
    }
  }, [draft, commit, removeAt, values.length])

  return (
    <div className="design-tags-editor" data-testid={testId}>
      <div className="design-tags-chips">
        {values.map((value, index) => (
          <span key={`${String(value)}:${String(index)}`} className="design-tag-chip" data-testid={`${testId}-chip`}>
            <span className="design-tag-chip-label">{String(value)}</span>
            <button
              type="button"
              className="design-tag-chip-remove codicon codicon-close"
              onClick={() => { removeAt(index) }}
              aria-label={t('design.enum.removeValue', 'Remove value')}
              data-testid={`${testId}-remove-${String(index)}`}
            />
          </span>
        ))}
      </div>
      <InputBox
        value={draft}
        onChange={setDraft}
        onKeyDown={onKeyDown}
        changeDebounceMs={0}
        options={{
          type: 'text',
          placeholder: t('design.enum.addValue', 'Add a value…'),
          ariaLabel: t('design.enum.addValue', 'Add a value…')
        }}
        data-testid={`${testId}-input`}
      />
    </div>
  )
}
