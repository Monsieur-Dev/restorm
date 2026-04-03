import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type * as monacoEditor from 'monaco-editor'
import { VariableInputBox, type VariableDefinition } from '../VariableInputBox'
import type { DateTimePickerOutputMode } from './types'

const LUXON_LANGUAGE_ID = 'luxon-format'

// List of all Luxon token names (in order from the documentation)
const LUXON_TOKEN_NAMES = [
  'S', 'SSS', 'u', 'uu', 'uuu', 's', 'ss', 'm', 'mm', 'h', 'hh', 'H', 'HH',
  'Z', 'ZZ', 'ZZZ', 'ZZZZ', 'ZZZZZ', 'z', 'a', 'd', 'dd', 'c', 'ccc', 'cccc', 'ccccc',
  'L', 'LL', 'LLL', 'LLLL', 'LLLLL', 'y', 'yy', 'yyyy', 'G', 'GG', 'GGGGG',
  'kk', 'kkkk', 'W', 'WW', 'ii', 'iiii', 'n', 'nn', 'o', 'ooo', 'q', 'qq',
  'D', 'DD', 'DDD', 'DDDD', 't', 'tt', 'ttt', 'tttt', 'T', 'TT', 'TTT', 'TTTT',
  'f', 'ff', 'fff', 'ffff', 'F', 'FF', 'FFF', 'FFFF', 'X', 'x'
]

function getLuxonTokens(t: (key: string) => string): VariableDefinition[] {
  return LUXON_TOKEN_NAMES.map(name => ({
    name,
    value: name,
    description: t(`dateTimePicker.tokens.${name}`)
  }))
}

export interface OutputSettingsProps {
  /** Current output mode. */
  outputMode: DateTimePickerOutputMode
  /** Called when the output mode changes. */
  onOutputModeChange: (mode: DateTimePickerOutputMode) => void
  /** Current pattern string. */
  pattern: string
  /** Called when the pattern changes. */
  onPatternChange: (pattern: string) => void
  /** Preview string to display below the pattern editor. */
  previewValue: string
  /** Whether interaction is disabled. */
  disabled: boolean
  /** Test-id prefix. */
  testId: string
}

const OutputSettingsInner: React.FC<OutputSettingsProps> = ({
  outputMode,
  onOutputModeChange,
  pattern,
  onPatternChange,
  previewValue,
  disabled,
  testId
}) => {
  const { t } = useTranslation()
  const luxonTokens = useMemo(() => getLuxonTokens(t), [t])
  const completionProviderDisposableRef = useRef<monacoEditor.IDisposable | null>(null)

  const handlePatternInputMount = useCallback(
    (_editor: monacoEditor.editor.IStandaloneCodeEditor, monaco: typeof monacoEditor): void => {
      const hasLanguage = monaco.languages.getLanguages().some((lang) => lang.id === LUXON_LANGUAGE_ID)
      if (!hasLanguage) {
        monaco.languages.register({ id: LUXON_LANGUAGE_ID })
      }

      if (completionProviderDisposableRef.current) {
        completionProviderDisposableRef.current.dispose()
      }

      completionProviderDisposableRef.current = monaco.languages.registerCompletionItemProvider(LUXON_LANGUAGE_ID, {
        triggerCharacters: ['y', 'M', 'd', 'c', 'H', 'h', 'm', 's', 'S', 'a', 'Z', 'z', 'L', 'G', 'k', 'W', 'i', 'n', 'o', 'q', 'D', 't', 'T', 'f', 'F', 'X', 'x', 'u'],
        provideCompletionItems(model: monacoEditor.editor.ITextModel, position: monacoEditor.Position, _context: monacoEditor.languages.CompletionContext) {
          const word = model.getWordAtPosition(position)

          const suggestions: monacoEditor.languages.CompletionItem[] = []

          if (word && word.word.length > 0) {
            const wordLower = word.word.toLowerCase()
            for (const token of luxonTokens) {
              if (token.name.toLowerCase().startsWith(wordLower) || wordLower.startsWith(token.name.toLowerCase())) {
                const item: monacoEditor.languages.CompletionItem = {
                  label: token.name,
                  kind: monaco.languages.CompletionItemKind.Value,
                  insertText: token.name,
                  detail: token.description ?? 'Luxon token',
                  range: {
                    startLineNumber: position.lineNumber,
                    endLineNumber: position.lineNumber,
                    startColumn: word.startColumn,
                    endColumn: word.endColumn
                  }
                }
                if (token.description) {
                  item.documentation = token.description
                }
                suggestions.push(item)
              }
            }
          } else {
            const range = {
              startLineNumber: position.lineNumber,
              endLineNumber: position.lineNumber,
              startColumn: position.column,
              endColumn: position.column
            }
            for (const token of luxonTokens) {
              const item: monacoEditor.languages.CompletionItem = {
                label: token.name,
                kind: monaco.languages.CompletionItemKind.Value,
                insertText: token.name,
                detail: token.description ?? 'Luxon token',
                range
              }
              if (token.description) {
                item.documentation = token.description
              }
              suggestions.push(item)
            }
          }

          return { suggestions, incomplete: false }
        }
      })
    },
    [luxonTokens]
  )

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (completionProviderDisposableRef.current) {
        completionProviderDisposableRef.current.dispose()
        completionProviderDisposableRef.current = null
      }
    }
  }, [])

  return (
    <>
      <div className="ecu-date-time-picker-output" data-testid={`${testId}-output`}>
        <label className="ecu-date-time-picker-output-label">{t('dateTimePicker.output')}</label>
        <select
          className="ecu-date-time-picker-select"
          data-testid={`${testId}-output-mode`}
          value={outputMode}
          onChange={(e) => {
            onOutputModeChange(e.target.value as DateTimePickerOutputMode)
          }}
          disabled={disabled}
        >
          <option value="pattern">{t('dateTimePicker.outputModes.pattern')}</option>
          <option value="unix">{t('dateTimePicker.outputModes.unix')}</option>
          <option value="epoch">{t('dateTimePicker.outputModes.epoch')}</option>
          <option value="iso">{t('dateTimePicker.outputModes.iso')}</option>
        </select>
      </div>

      {outputMode === 'pattern' ? (
        <div className="ecu-date-time-picker-pattern" data-testid={`${testId}-pattern-section`}>
          <div className="ecu-date-time-picker-pattern-wrapper">
            <VariableInputBox
              data-testid={`${testId}-pattern`}
              value={pattern}
              onChange={onPatternChange}
              variables={[]}
              placeholder="yyyy-MM-dd HH:mm:ss"
              ariaLabel={t('dateTimePicker.pattern')}
              style={{ width: '100%', opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? 'none' : 'auto' }}
              onMount={handlePatternInputMount}
              languageId={LUXON_LANGUAGE_ID}
              disableDefaultProviders
            />
          </div>
          <div className="ecu-date-time-picker-preview">
            <div className="ecu-date-time-picker-preview-label">{t('dateTimePicker.preview')}</div>
            <div className="ecu-date-time-picker-preview-value" data-testid={`${testId}-preview-value`}>{previewValue}</div>
          </div>
        </div>
      ) : null}
    </>
  )
}

export const OutputSettings = React.memo(OutputSettingsInner)
