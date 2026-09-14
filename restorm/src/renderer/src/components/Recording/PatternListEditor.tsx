import React from 'react'
import { useTranslation } from 'react-i18next'
import { Button, InputBox, MessageType } from 'electron-core-ui/renderer'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'
import { isValidFilterPattern } from '../../../../shared/recording/captureFilters'

export interface PatternListEditorProps {
  /** Regex sources, one per row. */
  patterns: readonly string[]
  /** Called with the whole next list on every edit (add / change / remove). */
  onChange: (next: string[]) => void
  /** i18n label of the list (the section title). */
  label: string
  disabled?: boolean
  'data-testid': string
}

/**
 * One regex per row, an add button, a trash per row — the white / black list
 * editor of a recording session. A pattern that does not compile is flagged
 * inline (the engine ignores it; see `captureFilters`).
 */
export const PatternListEditor: React.FC<PatternListEditorProps> = ({ patterns, onChange, label, disabled, 'data-testid': testId }) => {
  const { t } = useTranslation()
  const update = (index: number, value: string): void => {
    const next = [...patterns]
    next[index] = value
    onChange(next)
  }
  const remove = (index: number): void => {
    onChange(patterns.filter((_p, i) => i !== index))
  }
  const add = (): void => {
    onChange([...patterns, ''])
  }
  return (
    <div className="recording-pattern-list" data-testid={testId}>
      <div className="recording-pattern-list-header">
        <span className="design-field-label">{label}</span>
        <HeaderHoverTooltip label={t('recording.config.addPattern')}>
          <Button
            secondary
            small
            icon="add"
            options={{ ariaLabel: t('recording.config.addPattern'), disabled: disabled === true }}
            onClick={add}
            data-testid={`${testId}-add`}
          />
        </HeaderHoverTooltip>
      </div>
      {patterns.length === 0 && (
        <p className="design-field-hint" data-testid={`${testId}-empty`}>{t('recording.config.noPattern')}</p>
      )}
      {patterns.map((pattern, index) => (
        <div className="recording-pattern-row" key={index} data-testid={`${testId}-row-${index}`}>
          <div className="recording-pattern-input">
            <InputBox
              value={pattern}
              onChange={(value) => { update(index, value) }}
              readOnly={disabled === true}
              options={{
                type: 'text',
                placeholder: t('recording.config.patternPlaceholder'),
                ariaLabel: `${label} ${index + 1}`,
                validationOptions: {
                  validation: (value: string) => (isValidFilterPattern(value)
                    ? null
                    : { content: t('recording.config.invalidPattern'), type: MessageType.ERROR })
                }
              }}
              data-testid={`${testId}-input-${index}`}
            />
          </div>
          <HeaderHoverTooltip label={t('recording.config.removePattern')}>
            <Button
              secondary
              small
              icon="trash"
              options={{ ariaLabel: t('recording.config.removePattern'), disabled: disabled === true }}
              onClick={() => { remove(index) }}
              data-testid={`${testId}-remove-${index}`}
            />
          </HeaderHoverTooltip>
        </div>
      ))}
    </div>
  )
}
