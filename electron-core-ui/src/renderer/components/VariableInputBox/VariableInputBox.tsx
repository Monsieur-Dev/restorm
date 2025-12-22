import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type * as monacoEditor from 'monaco-editor'
import type { VariableInputBoxProps, VariableDefinition, HelperDefinition } from './types'
import { defaultInputBoxStyles } from '../InputBox/types'
import { CodeEditor } from '../CodeEditor/CodeEditor'
import { Tooltip } from '../Tooltip'
import { ContextMenu, type ContextMenuItem } from '../ContextMenu/ContextMenu'
import '../InputBox/inputBox.css'
import './variableInputBox.css'

const LANGUAGE_ID = 'handlebars'

interface ModelData {
  variables: VariableDefinition[]
  helpers: HelperDefinition[]
}

// Category prefixes for filtering (e.g., typing "arr:" shows only array helpers)
const CATEGORY_PREFIXES: Record<string, string> = {
  comparison: 'comp',
  string: 'str',
  math: 'math',
  array: 'arr',
  object: 'obj',
  url: 'url',
  date: 'date',
  regex: 'regex',
  misc: 'misc'
}

// Pre-computed helper suggestion data (without range which varies per position)
interface CachedHelperSuggestion {
  label: { label: string; description: string }
  kind: number // CompletionItemKind.Function
  insertText: string
  filterText: string
  documentation: { value: string }
  detail: string
  sortText: string
}

// Use window to persist state across hot reloads
const globalKey = '__variableInputBoxProviders__'
interface ProviderState {
  languageConfigured: boolean
  completionProviderDisposable: monacoEditor.IDisposable | null
  hoverProviderDisposable: monacoEditor.IDisposable | null
  cancellationHandlerRegistered: boolean
  modelDataMap: WeakMap<monacoEditor.editor.ITextModel, ModelData>
  // Cache for helper suggestions (keyed by stringified helpers array)
  helperSuggestionsCache: Map<string, CachedHelperSuggestion[]>
}

function getProviderState(): ProviderState {
  const win = window as unknown as Record<string, ProviderState | undefined>
  win[globalKey] ??= {
    languageConfigured: false,
    completionProviderDisposable: null,
    hoverProviderDisposable: null,
    cancellationHandlerRegistered: false,
    modelDataMap: new WeakMap(),
    helperSuggestionsCache: new Map()
  }
  return win[globalKey]
}

// Build cached helper suggestions (computed once per unique helpers array)
function getCachedHelperSuggestions(
  helpers: HelperDefinition[],
  functionKind: number
): CachedHelperSuggestion[] {
  const state = getProviderState()
  // Use helper names as cache key (assumes helpers don't change content, only list)
  const cacheKey = helpers.map((h) => h.name).join(',')

  let cached = state.helperSuggestionsCache.get(cacheKey)
  if (!cached) {
    cached = helpers.map((h) => {
      const docParts = [h.description, '', `**Syntax:** \`${h.syntax}\``]
      if (h.example) {
        docParts.push('', `**Example:** ${h.example}`)
      }

      const categoryKey =
        Object.keys(CATEGORY_PREFIXES).find(
          (key) => h.category.toLowerCase().includes(key) || key.includes(h.category.toLowerCase())
        ) ?? 'misc'
      const prefix = CATEGORY_PREFIXES[categoryKey] ?? 'misc'

      return {
        label: { label: h.name, description: h.category },
        kind: functionKind,
        insertText: `{{${h.name} }}`,
        filterText: `${prefix}:${h.name} ${h.name}`,
        documentation: { value: docParts.join('\n') },
        detail: `${h.category} helper`,
        sortText: `1_${categoryKey}_${h.name}`
      }
    })
    state.helperSuggestionsCache.set(cacheKey, cached)
  }
  return cached
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
  const { t } = useTranslation()
  const {
    value,
    onChange,
    variables,
    helpers = [],
    placeholder,
    resolvedValue,
    id,
    className,
    style,
    ariaLabel
  } = props
  const editorRef = useRef<monacoEditor.editor.IStandaloneCodeEditor | null>(null)
  const variablesRef = useRef<VariableDefinition[]>(variables)
  const helpersRef = useRef<HelperDefinition[]>(helpers)
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
    const text = await navigator.clipboard.readText()
    editorRef.current?.trigger('keyboard', 'paste', { text })
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
      { id: 'cut', label: t('contextMenu.cut'), onClick: handleCut },
      { id: 'copy', label: t('contextMenu.copy'), onClick: handleCopy },
      { id: 'paste', label: t('contextMenu.paste'), onClick: () => { void handlePaste() } }
    ]
    
    if (props.onGoToDefinition) {
      items.push(
        { id: 'sep1', label: '', isSeparator: true },
        { id: 'goToDefinition', label: t('contextMenu.goToDefinition'), onClick: handleGoToDefinition }
      )
    }
    
    return items
  }, [t, handleCut, handleCopy, handlePaste, handleGoToDefinition, props.onGoToDefinition])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY })
  }, [])

  const closeContextMenu = useCallback(() => {
    setContextMenu(prev => ({ ...prev, visible: false }))
  }, [])

  // Keep refs in sync
  variablesRef.current = variables
  helpersRef.current = helpers

  // Update modelDataMap when variables or helpers change AND editor is mounted
  useEffect(() => {
    if (!editorMounted) return
    const model = editorRef.current?.getModel()
    if (model) {
      getProviderState().modelDataMap.set(model, { variables, helpers })
    }
  }, [variables, helpers, editorMounted])

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
      insertSpaces: true,
      // Suggestion widget options
      suggest: {
        showIcons: true,
        showStatusBar: true,
        // Show documentation panel expanded by default
        showInlineDetails: true,
        // Show the details panel on the side when navigating suggestions
        detailsVisible: true,
        // Preview the suggestion in the editor
        preview: true
      }
    }),
    []
  )

  const handleMount = (
    editor: monacoEditor.editor.IStandaloneCodeEditor,
    monacoInstance: typeof monacoEditor
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

    state.completionProviderDisposable ??= monacoInstance.languages.registerCompletionItemProvider(LANGUAGE_ID, {
        triggerCharacters: ['{'],
        provideCompletionItems(model: monacoEditor.editor.ITextModel, position: monacoEditor.Position) {
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: position.column,
            endColumn: position.column
          }

          const data = getProviderState().modelDataMap.get(model) ?? { variables: [], helpers: [] }
          const suggestions: monacoEditor.languages.CompletionItem[] = []

          // Add variable suggestions
          for (const v of data.variables) {
            const labelObj: { label: string; description?: string } = { label: v.name }
            if (v.value) {
              labelObj.description = v.value
            }
            suggestions.push({
              label: labelObj as monacoEditor.languages.CompletionItemLabel,
              kind: monacoInstance.languages.CompletionItemKind.Variable,
              insertText: `{{${v.name}}}`,
              documentation: v.description ?? v.value,
              detail: 'variable',
              sortText: `0_${v.name}`, // Variables first
              range
            })
          }

          // Add cached helper suggestions (only range needs to be added per call)
          const cachedHelpers = getCachedHelperSuggestions(
            data.helpers,
            monacoInstance.languages.CompletionItemKind.Function
          )
          for (const cached of cachedHelpers) {
            suggestions.push({
              ...cached,
              label: cached.label as monacoEditor.languages.CompletionItemLabel,
              range
            })
          }

          // incomplete: true forces Monaco to always recalculate suggestions
          // instead of using cached results when variables change
          return { suggestions, incomplete: true }
        }
      })

    state.hoverProviderDisposable ??= monacoInstance.languages.registerHoverProvider(LANGUAGE_ID, {
        provideHover(model: monacoEditor.editor.ITextModel, position: monacoEditor.Position) {
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

          // Extract the content between {{ and }}, get first word (helper/variable name)
          const innerContent = lineText.substring(openIndex + 2, closeIndex).trim()
          const name = innerContent.split(/\s+/)[0] ?? ''

          const data = getProviderState().modelDataMap.get(model) ?? { variables: [], helpers: [] }

          // Check if it's a variable
          const varMatch = data.variables.find((v) => v.name === name)
          if (varMatch) {
            const range = new monacoInstance.Range(
              position.lineNumber,
              openIndex + 1,
              position.lineNumber,
              closeIndex + 3
            )
            return {
              range,
              contents: [
                { value: `**${varMatch.name}** *(variable)*` },
                { value: '```text\n' + (varMatch.value || '(empty)') + '\n```' }
              ]
            }
          }

          // Check if it's a helper (also check with # prefix for block helpers)
          const helperName = name.startsWith('#') ? name.slice(1) : name
          const helperMatch = data.helpers.find((h) => h.name === helperName)
          if (helperMatch) {
            const range = new monacoInstance.Range(
              position.lineNumber,
              openIndex + 1,
              position.lineNumber,
              closeIndex + 3
            )
            const docParts = [
              `**${helperMatch.name}** *(${helperMatch.category} helper)*`,
              '',
              helperMatch.description,
              '',
              `**Syntax:** \`${helperMatch.syntax}\``
            ]
            if (helperMatch.example) {
              docParts.push('', `**Example:** ${helperMatch.example}`)
            }
            return {
              range,
              contents: [{ value: docParts.join('\n') }]
            }
          }

          return { contents: [] }
        }
      })

    // Prevent multiline input to behave like a multi-line editor
    // Block Enter with any modifier (Ctrl+Enter, Shift+Enter, etc.)
    editor.onKeyDown((e) => {
      if (e.keyCode === monacoInstance.KeyCode.Enter) {
        e.preventDefault()
        e.stopPropagation()
      }
    })

    // Also remove default keybindings for inserting lines
    editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.Enter, () => {
      // Do nothing - prevent Ctrl+Enter from inserting a line
    })
    editor.addCommand(monacoInstance.KeyMod.Shift | monacoInstance.KeyCode.Enter, () => {
      // Do nothing - prevent Shift+Enter from inserting a line
    })

    // Block local Ctrl/Cmd+F inside this compact editor only
    const domNode = editor.getDomNode()
    if (domNode) {
      const preventFind = (event: KeyboardEvent): void => {
        const isMac = navigator.userAgent.toLowerCase().includes('mac')
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
      state.modelDataMap.set(model, {
        variables: variablesRef.current,
        helpers: helpersRef.current
      })
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
        className={['inputbox', 'idle', className].filter(Boolean).join(' ')}
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
