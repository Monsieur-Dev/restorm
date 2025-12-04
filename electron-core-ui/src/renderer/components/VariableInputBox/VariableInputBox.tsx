import React, { useEffect, useMemo, useRef } from 'react'
import Editor from '@monaco-editor/react'
import type { Monaco } from '@monaco-editor/react'
import type * as monacoEditor from 'monaco-editor'
import type { VariableInputBoxProps, VariableDefinition } from './types'
import { defaultInputBoxStyles } from '../InputBox/types'
import '../InputBox/inputBox.css'
import './variableInputBox.css'

const LANGUAGE_ID = 'handlebars'
const THEME_ID = 'variable-handlebars-theme'

let languageConfigured = false
let completionProviderDisposable: monacoEditor.IDisposable | null = null
let hoverProviderDisposable: monacoEditor.IDisposable | null = null
let lastMonacoInstance: Monaco | null = null
let themeObserverInitialized = false
let cancellationHandlerRegistered = false

const isMonacoCancellationError = (reason: unknown): boolean => {
  if (!reason) return false

  if (typeof reason === 'string') {
    return reason === 'Canceled' || reason.includes('Canceled: Canceled')
  }

  const maybeError = reason as { message?: unknown; name?: unknown }
  const message = typeof maybeError.message === 'string' ? maybeError.message : ''
  const name = typeof maybeError.name === 'string' ? maybeError.name : ''

  return name === 'Canceled' || message === 'Canceled' || message.includes('Canceled: Canceled')
}

const VariableInputBox: React.FC<VariableInputBoxProps> = ({
  value,
  onChange,
  variables,
  placeholder,
  id,
  className,
  style,
  ariaLabel
}) => {
  const editorRef = useRef<monacoEditor.editor.IStandaloneCodeEditor | null>(null)
  const variablesRef = useRef<VariableDefinition[]>(variables)

  useEffect(() => {
    variablesRef.current = variables
  }, [variables])

  useEffect(() => {
    if (typeof window === 'undefined' || cancellationHandlerRegistered) return

    const handler = (event: PromiseRejectionEvent): void => {
      if (isMonacoCancellationError(event.reason)) {
        event.preventDefault()
      }
    }

    window.addEventListener('unhandledrejection', handler)
    cancellationHandlerRegistered = true
  }, [])

  const editorOptions = useMemo(
    () => ({
      lineNumbers: 'off' as const,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: 'off' as const,
      glyphMargin: false,
      folding: false,
      lineDecorationsWidth: 0,
      lineNumbersMinChars: 0,
      overviewRulerLanes: 0,
      renderLineHighlight: 'none' as const,
      renderIndentGuides: false,
      automaticLayout: true,
      scrollbar: {
        vertical: 'hidden' as const,
        horizontal: 'hidden' as const,
        handleMouseWheel: false,
        useShadows: false,
        verticalScrollbarSize: 0,
        horizontalScrollbarSize: 0,
        alwaysConsumeMouseWheel: false
      },
      quickSuggestions: false,
      suggestOnTriggerCharacters: true,
      fontSize: 13,
      lineHeight: 16,
      padding: {
        top: 4,
        bottom: 0
      },
      mouseWheelScrollSensitivity: 0,
      fastScrollSensitivity: 0,
      tabSize: 2,
      insertSpaces: true
    }),
    []
  )

  const applyThemeToEditor = (monacoInstance: Monaco): void => {
    lastMonacoInstance = monacoInstance
    const themeAttr = document.documentElement.getAttribute('data-theme') ?? 'dark'
    const isDark = themeAttr === 'dark' || themeAttr === 'hc'
    const baseTheme = isDark ? 'vs-dark' : 'vs'

    monacoInstance.editor.defineTheme(THEME_ID, {
      base: baseTheme,
      inherit: true,
      rules: [
        {
          token: 'variableToken',
          foreground: 'c586c0',
          fontStyle: 'bold'
        }
      ],
      colors: {
        'editor.background': '#00000000',
        'editor.lineHighlightBackground': '#00000000',
        'editorGutter.background': '#00000000'
      }
    })
    monacoInstance.editor.setTheme(THEME_ID)
  }

  const handleMount = (
    editor: monacoEditor.editor.IStandaloneCodeEditor,
    monacoInstance: Monaco
  ): void => {
    editorRef.current = editor

    // Configure language, theme, completion and hover for Handlebars-style variables
    if (!languageConfigured) {
      monacoInstance.languages.setMonarchTokensProvider(LANGUAGE_ID, {
        tokenizer: {
          root: [[/\{\{[^}]+\}\}/, 'variableToken']]
        }
      })
      languageConfigured = true
    }

    applyThemeToEditor(monacoInstance)

    if (!themeObserverInitialized) {
      const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === 'attributes' && m.attributeName === 'data-theme') {
            if (lastMonacoInstance) {
              applyThemeToEditor(lastMonacoInstance)
            }
          }
        }
      })
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
      themeObserverInitialized = true
    }

    if (!completionProviderDisposable) {
      completionProviderDisposable = monacoInstance.languages.registerCompletionItemProvider(LANGUAGE_ID, {
        triggerCharacters: ['{'],
        provideCompletionItems(_model, position) {
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: position.column,
            endColumn: position.column
          }

          const vars = variablesRef.current
          const suggestions = vars.map((v) => ({
            label: v.name,
            kind: monacoInstance.languages.CompletionItemKind.Variable,
            insertText: `{{${v.name}}}`,
            detail: v.value,
            documentation: v.description ?? v.value,
            range
          }))

          return { suggestions }
        }
      })
    }

    if (!hoverProviderDisposable) {
      hoverProviderDisposable = monacoInstance.languages.registerHoverProvider(LANGUAGE_ID, {
        provideHover(model, position) {
          const lineText = model.getLineContent(position.lineNumber)
          const col = position.column

          const openIndex = lineText.lastIndexOf('{{', col - 1)
          const closeIndex = lineText.indexOf('}}', openIndex + 2)

          if (openIndex === -1 || closeIndex === -1) {
            return { contents: [] }
          }

          if (col < openIndex + 1 || col > closeIndex + 3) {
            return { contents: [] }
          }

          const name = lineText.substring(openIndex + 2, closeIndex).trim()
          const vars = variablesRef.current
          const match = vars.find((v) => v.name === name)

          if (!match) {
            return { contents: [] }
          }

          const range = new monacoInstance.Range(
            position.lineNumber,
            openIndex + 1,
            position.lineNumber,
            closeIndex + 3
          )

          return {
            range,
            contents: [
              { value: `**${match.name}**` },
              { value: '```text\n' + (match.value || '(empty)') + '\n```' }
            ]
          }
        }
      })
    }

    // Prevent multiline input to behave like a multi-line editor
    editor.onKeyDown((e) => {
      if (e.keyCode === monacoInstance.KeyCode.Enter) {
        e.preventDefault()
      }
    })

    // Block external drag & drop and local Ctrl/Cmd+F inside this compact editor only
    const domNode = editor.getDomNode()
    if (domNode) {
      const preventDrop = (event: DragEvent): void => {
        event.preventDefault()
        event.stopPropagation()
      }
      const preventFind = (event: KeyboardEvent): void => {
        const isMac = navigator.platform.toLowerCase().includes('mac')
        const isCtrlOrCmd = isMac ? event.metaKey : event.ctrlKey
        if (isCtrlOrCmd && (event.key === 'f' || event.key === 'F')) {
          event.preventDefault()
          event.stopPropagation()
        }
      }

      domNode.addEventListener('drop', preventDrop, true)
      domNode.addEventListener('dragover', preventDrop, true)
      domNode.addEventListener('keydown', preventFind, true)
    }

    if (ariaLabel) {
      editor.updateOptions({ ariaLabel })
    }
  }

  return (
    <div>
      <div
        id={id}
        className={['monaco-inputbox', 'idle', className].filter(Boolean).join(' ')}
        style={{
          backgroundColor: defaultInputBoxStyles.inputBackground,
          color: defaultInputBoxStyles.inputForeground,
          border: `1px solid ${defaultInputBoxStyles.inputBorder ?? 'transparent'}`,
          minHeight: 28,
          ...(style ?? {})
        }}
      >
        <div className="ibwrapper" style={{ display: 'flex', alignItems: 'center' }}>
          {placeholder && !value && (
            <div
              style={{
                position: 'absolute',
                top: 5,
                left: 8,
                right: 8,
                pointerEvents: 'none',
                opacity: 0.5,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                fontSize: 12
              }}
            >
              {placeholder}
            </div>
          )}

          <div
            className="input variable-inputbox-editor"
            style={{ padding: '0 6px', width: '100%' }}
            onDrop={(e) => {
              // Prevent external drag & drop (e.g. tabs, rows) from inserting text into Monaco
              e.preventDefault()
            }}
            onDragOver={(e) => {
              e.preventDefault()
            }}
          >
            <Editor
              value={value}
              onChange={(v) => {
                onChange(v ?? '')
              }}
              language={LANGUAGE_ID}
              theme={THEME_ID}
              height={20}
              options={editorOptions}
              onMount={handleMount}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export { VariableInputBox }


