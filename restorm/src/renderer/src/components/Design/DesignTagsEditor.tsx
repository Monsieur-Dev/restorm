import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { InputBox, getColorFromString } from 'electron-core-ui/renderer'

export interface DesignTagsEditorProps {
  /** Current tags. */
  tags: string[]
  /** Commit a new tag list (add / remove). */
  onChange: (tags: string[]) => void
  /** Placeholder for the add-input (already translated). */
  placeholder?: string
  'data-testid'?: string
}

/**
 * A compact chip editor for a route's or group's tags. Existing tags render as
 * removable coloured chips (the swatch is the app's name-derived tag colour, so
 * a tag reads the same here as in the sidebar); a new tag is typed into the
 * input and committed on Enter or comma. Blank and duplicate entries are
 * dropped, so the list stays clean without the caller policing it.
 */
export const DesignTagsEditor: React.FC<DesignTagsEditorProps> = ({ tags, onChange, placeholder, 'data-testid': dataTestId }) => {
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')
  const testId = dataTestId ?? 'design-tags'

  const commit = useCallback((raw: string) => {
    const value = raw.trim()
    if (value === '' || tags.includes(value)) { setDraft(''); return }
    onChange([...tags, value])
    setDraft('')
  }, [tags, onChange])

  const removeAt = useCallback((index: number) => {
    onChange(tags.filter((_, i) => i !== index))
  }, [tags, onChange])

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commit(draft)
    } else if (e.key === 'Backspace' && draft === '' && tags.length > 0) {
      // Backspace on an empty input removes the last chip — the usual chip-input
      // affordance.
      removeAt(tags.length - 1)
    }
  }, [draft, commit, removeAt, tags.length])

  return (
    <div className="design-tags-editor" data-testid={testId}>
      <div className="design-tags-chips">
        {tags.map((tag, index) => (
          <span key={`${tag}:${String(index)}`} className="design-tag-chip" data-testid={`${testId}-chip`}>
            <span className="design-tag-chip-swatch" style={{ backgroundColor: getColorFromString(tag) }} aria-hidden="true" />
            <span className="design-tag-chip-label">{tag}</span>
            <button
              type="button"
              className="design-tag-chip-remove codicon codicon-close"
              onClick={() => { removeAt(index) }}
              aria-label={t('design.tags.remove', 'Remove tag')}
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
          placeholder: placeholder ?? t('design.tags.add', 'Add a tag…'),
          ariaLabel: placeholder ?? t('design.tags.add', 'Add a tag…')
        }}
        data-testid={`${testId}-input`}
      />
    </div>
  )
}
