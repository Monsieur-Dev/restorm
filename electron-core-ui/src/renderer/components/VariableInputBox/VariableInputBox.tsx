import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Monaco } from '@monaco-editor/react'
import type * as monacoEditor from 'monaco-editor'
import type { VariableInputBoxProps, VariableDefinition } from './types'
import { defaultInputBoxStyles } from '../InputBox/types'
import { CodeEditor } from '../CodeEditor/CodeEditor'
import { Tooltip } from '../Tooltip'
import { ContextMenu, type ContextMenuItem } from '../ContextMenu/ContextMenu'
import '../InputBox/inputBox.css'
import './variableInputBox.css'

const LANGUAGE_ID = 'handlebars'

// Use window to persist state across hot reloads
const globalKey = '__variableInputBoxProviders__'
interface ProviderState {
  languageConfigured: boolean
  completionProviderDisposable: monacoEditor.IDisposable | null
  hoverProviderDisposable: monacoEditor.IDisposable | null
  cancellationHandlerRegistered: boolean
  modelVariablesMap: WeakMap<monacoEditor.editor.ITextModel, VariableDefinition[]>
}

function getProviderState(): ProviderState {
  const win = window as unknown as Record<string, ProviderState | undefined>
  if (!win[globalKey]) {
    win[globalKey] = {
      languageConfigured: false,
      completionProviderDisposable: null,
      hoverProviderDisposable: null,
      cancellationHandlerRegistered: false,
      modelVariablesMap: new WeakMap()
    }
  }
  return win[globalKey]
}


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
  const [showResolvedTooltip, setShowResolvedTooltip] = useState(false)
  const [editorMounted, setEditorMounted] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ visible: boolean; x: number; y: number }>({
    visible: false,
    x: 0,
    y: 0
  })

  const hasResolvedTooltip = Boolean(resolvedValue && resolvedValue !== value)

  // Context menu handlers
  const handleCut = useCallback(() => {
    editorRef.current?.focus()
    editorRef.current?.trigger('keyboard', 'editor.action.clipboardCutAction', null)
  }, [])

  const handleCopy = useCallback(() => {
    editorRef.current?.focus()
    editorRef.current?.trigger('keyboard', 'editor.action.clipboardCopyAction', null)
  }, [])

  const handlePaste = useCallback(async () => {
    editorRef.current?.focus()
    try {
      const text = await navigator.clipboard.readText()
      editorRef.current?.trigger('keyboard', 'paste', { text })
    } catch {
      // Fallback: use execCommand
      document.execCommand('paste')
    }
  }, [])

  const handleGoToDefinition = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    
    const position = editor.getPosition()
    if (!position) return
    
    const model = editor.getModel()
    if (!model) return
    
    const lineText = model.getLineContent(position.lineNumber)
    const col = position.column
    
    // Find variable under cursor: {{variableName}}
    const openIndex = lineText.lastIndexOf('{{', col - 1)
    const closeIndex = lineText.indexOf('}}', openIndex + 2)
    
    if (openIndex !== -1 && closeIndex !== -1 && col >= openIndex + 1 && col <= closeIndex + 3) {
      const variableName = lineText.substring(openIndex + 2, closeIndex).trim()
      // Trigger the onGoToDefinition callback if it exists
      if (props.onGoToDefinition) {
        props.onGoToDefinition(variableName)
      }
    }
  }, [props])

  const contextMenuItems = useMemo<ContextMenuItem[]>(() => {
    const items: ContextMenuItem[] = [
      { id: 'cut', label: 'Cut', onClick: handleCut },
      { id: 'copy', label: 'Copy', onClick: handleCopy },
      { id: 'paste', label: 'Paste', onClick: handlePaste }
    ]
    
    if (props.onGoToDefinition) {
      items.push(
        { id: 'sep1', label: '', isSeparator: true },
        { id: 'goToDefinition', label: 'Go to Definition', onClick: handleGoToDefinition }
      )
    }
    
    return items
  }, [handleCut, handleCopy, handlePaste, handleGoToDefinition, props.onGoToDefinition])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY })
  }, [])

  const closeContextMenu = useCallback(() => {
    setContextMenu(prev => ({ ...prev, visible: false }))
  }, [])

  // Keep variablesRef in sync
  variablesRef.current = variables

  // Update modelVariablesMap when variables change AND editor is mounted
  useEffect(() => {
    if (!editorMounted) return
    const model = editorRef.current?.getModel()
    if (model) {
      getProviderState().modelVariablesMap.set(model, variables)
    }
  }, [variables, editorMounted])

  useEffect(() => {
    const state = getProviderState()
    if (typeof window === 'undefined' || state.cancellationHandlerRegistered) return

    const handler = (event: PromiseRejectionEvent): void => {
      if (isMonacoCancellationError(event.reason)) {
        event.preventDefault()
      }
    }

    window.addEventListener('unhandledrejection', handler)
    state.cancellationHandlerRegistered = true
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
      contextmenu: false,
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

    const state = getProviderState()

    // Configure language, completion and hover for Handlebars-style variables
    if (!state.languageConfigured) {
      monacoInstance.languages.setMonarchTokensProvider(LANGUAGE_ID, {
        tokenizer: {
          root: [[/\{\{[^}]+\}\}/, 'variableToken']]
        }
      })
      state.languageConfigured = true
    }

    if (!state.completionProviderDisposable) {
      state.completionProviderDisposable = monacoInstance.languages.registerCompletionItemProvider(LANGUAGE_ID, {
        triggerCharacters: ['{'],
        provideCompletionItems(model, position) {
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: position.column,
            endColumn: position.column
          }

          const vars = getProviderState().modelVariablesMap.get(model) ?? []
          const suggestions = vars.map((v) => {
            const labelObj: { label: string; description?: string } = { label: v.name }
            if (v.value) {
              labelObj.description = v.value
            }
            return {
              label: labelObj as monacoEditor.languages.CompletionItemLabel,
              kind: monacoInstance.languages.CompletionItemKind.Variable,
              insertText: `{{${v.name}}}`,
              documentation: v.description ?? v.value,
              range
            }
          })
          // incomplete: true forces Monaco to always recalculate suggestions
          // instead of using cached results when variables change
          return { suggestions, incomplete: true }
        }
      })
    }

    if (!state.hoverProviderDisposable) {
      state.hoverProviderDisposable = monacoInstance.languages.registerHoverProvider(LANGUAGE_ID, {
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
          const vars = getProviderState().modelVariablesMap.get(model) ?? []
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
      state.modelVariablesMap.set(model, variablesRef.current)
    }


    // Signal that editor is mounted so useEffect can update variables
    setEditorMounted(true)

    if (ariaLabel) {
      editor.updateOptions({ ariaLabel })
    }
  }

  return (
    <>
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
        onMouseEnter={() => {
          if (hasResolvedTooltip) {
            setShowResolvedTooltip(true)
          }
        }}
        onMouseLeave={() => {
          setShowResolvedTooltip(false)
        }}
        onContextMenu={handleContextMenu}
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
        {hasResolvedTooltip && (
          <Tooltip
            targetRef={containerRef}
            content={<span>{resolvedValue}</span>}
            show={showResolvedTooltip}
            placement="below"
          />
        )}
      </div>
      <ContextMenu
        visible={contextMenu.visible}
        x={contextMenu.x}
        y={contextMenu.y}
        items={contextMenuItems}
        onRequestClose={closeContextMenu}
      />
    </>
  )
}

export { VariableInputBox }
