import React, { useEffect, useMemo, useRef } from 'react'
import type { Monaco } from '@monaco-editor/react'
import type * as monacoEditor from 'monaco-editor'
import type { VariableInputBoxProps, VariableDefinition } from './types'
import { defaultInputBoxStyles } from '../InputBox/types'
import { CodeEditor } from '../CodeEditor/CodeEditor'
import '../InputBox/inputBox.css'
import './variableInputBox.css'

const LANGUAGE_ID = 'handlebars'

let languageConfigured = false
let completionProviderDisposable: monacoEditor.IDisposable | null = null
let hoverProviderDisposable: monacoEditor.IDisposable | null = null
let cancellationHandlerRegistered = false

// Map Monaco models to the variables that should be visible in their completion list.
// This avoids sharing a single variablesRef across all VariableInputBox instances.
const modelVariablesMap = new WeakMap<monacoEditor.editor.ITextModel, VariableDefinition[]>()

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

const VariableInputBox: React.FC<VariableInputBoxProps> = (props) => {
  const {
    value,
    onChange,
    variables,
    placeholder,
    resolvedValue,
    id,
    className,
    style,
    ariaLabel
  } = props
  const editorRef = useRef<monacoEditor.editor.IStandaloneCodeEditor | null>(null)
  const variablesRef = useRef<VariableDefinition[]>(variables)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    variablesRef.current = variables
    const model = editorRef.current?.getModel()
    if (model) {
      modelVariablesMap.set(model, variables)
    }
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
      // Render suggestion / hover widgets in a fixed overlay attached to body,
      // so they are not clipped by ancestor overflow: hidden (ScrollableElement, tables, etc.).
      fixedOverflowWidgets: true as const,
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

  const handleMount = (
    editor: monacoEditor.editor.IStandaloneCodeEditor,
    monacoInstance: Monaco
  ): void => {
    editorRef.current = editor

    // Configure language, completion and hover for Handlebars-style variables
    if (!languageConfigured) {
      monacoInstance.languages.setMonarchTokensProvider(LANGUAGE_ID, {
        tokenizer: {
          root: [[/\{\{[^}]+\}\}/, 'variableToken']]
        }
      })
      languageConfigured = true
    }

    if (!completionProviderDisposable) {
      completionProviderDisposable = monacoInstance.languages.registerCompletionItemProvider(LANGUAGE_ID, {
        triggerCharacters: ['{'],
        provideCompletionItems(model, position) {
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: position.column,
            endColumn: position.column
          }

          const vars = modelVariablesMap.get(model) ?? []
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
          const vars = modelVariablesMap.get(model) ?? []
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

    // Block local Ctrl/Cmd+F inside this compact editor only
    const domNode = editor.getDomNode()
    if (domNode) {
      const preventFind = (event: KeyboardEvent): void => {
        const isMac = navigator.platform.toLowerCase().includes('mac')
        const isCtrlOrCmd = isMac ? event.metaKey : event.ctrlKey
        if (isCtrlOrCmd && (event.key === 'f' || event.key === 'F')) {
          event.preventDefault()
          event.stopPropagation()
        }
      }

      domNode.addEventListener('keydown', preventFind, true)
    }

    const model = editor.getModel()
    if (model) {
      modelVariablesMap.set(model, variablesRef.current)
    }

    if (ariaLabel) {
      editor.updateOptions({ ariaLabel })
    }
  }

  return (
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
      ref={containerRef}
      title={resolvedValue && resolvedValue !== value ? resolvedValue : undefined}
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
        >
          <CodeEditor
            value={value}
            onChange={(v) => {
              onChange(v ?? '')
            }}
            language={LANGUAGE_ID}
            height={20}
            options={editorOptions}
            onMount={handleMount}
          />
        </div>
      </div>
    </div>
  )
}

export { VariableInputBox }


