import React from 'react'
import { useTranslation } from 'react-i18next'
import { InputBox, Button, getColorFromString } from 'electron-core-ui/renderer'

export interface ConflictTagsTabProps {
  tags: string[]
  /** Absent = read-only (the two comparison columns). */
  onChange?: (tags: string[]) => void
  /** Per-tag colours from the owning environment folder, when it has any.
   * A tag with no entry falls back to the name-derived colour — the same
   * one the sidebar shows. */
  tagColors?: Record<string, string> | undefined
  'data-testid'?: string
}

const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }
const swatchStyle: React.CSSProperties = { width: 14, height: 14, borderRadius: 3, flex: '0 0 auto' }

/**
 * The contested tag list, as a plain list of "colour square + name" rows —
 * the resolved column can rename, remove and add.
 *
 * Renaming a tag into a name the project has no colour for gives it the
 * name-derived default, which is the same thing that happens when a tag is
 * created anywhere else in the app: a renamed tag is a new tag, and it
 * starts with no special colour.
 */
export const ConflictTagsTab: React.FC<ConflictTagsTabProps> = ({ tags, onChange, tagColors, 'data-testid': dataTestId }) => {
  const { t } = useTranslation()
  const readOnly = onChange === undefined
  const testId = dataTestId ?? 'conflict-tags'

  const replaceAt = (index: number, value: string): void => {
    const next = [...tags]
    next[index] = value
    onChange?.(next)
  }

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 4 }} data-testid={testId}>
      {tags.length === 0 && (
        <div style={{ opacity: 0.7, fontSize: 12 }} data-testid={`${testId}-empty`}>
          {t('git.conflictTagsEmpty')}
        </div>
      )}
      {tags.map((tag, index) => (
        <div key={`${tag}:${String(index)}`} style={rowStyle} data-testid={`${testId}-row`}>
          <span
            style={{ ...swatchStyle, backgroundColor: tagColors?.[tag] ?? getColorFromString(tag) }}
            aria-hidden="true"
            data-testid={`${testId}-swatch`}
          />
          <InputBox
            value={tag}
            readOnly={readOnly}
            changeDebounceMs={0}
            {...(readOnly ? { onChange: () => undefined } : { onChange: (value: string) => { replaceAt(index, value) } })}
            options={{ ariaLabel: t('git.conflictTagName') }}
            data-testid={`${testId}-input-${String(index)}`}
          />
          {!readOnly && (
            <Button
              small
              icon="trash"
              options={{ ariaLabel: t('git.conflictTagRemove') }}
              onClick={() => { onChange(tags.filter((_, i) => i !== index)) }}
              data-testid={`${testId}-remove-${String(index)}`}
            />
          )}
        </div>
      ))}
      {!readOnly && (
        <div style={{ paddingTop: 4 }}>
          <Button
            icon="add"
            onClick={() => { onChange([...tags, t('git.conflictTagNew')]) }}
            data-testid={`${testId}-add`}
          >
            {t('git.conflictTagAdd')}
          </Button>
        </div>
      )}
    </div>
  )
}
