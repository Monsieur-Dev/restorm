import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type * as monacoEditor from 'monaco-editor'
import {
  VariableInputBox,
  Tooltip,
  ContextMenu,
  type ContextMenuItem,
  type VariableDefinition
} from 'electron-core-ui/renderer'
import type { TranslatedHelperDefinition } from '../../utils/handlebarsHelpersDefinitions'
import type { VariableTransformResult } from '../../types/global.d'

const LANGUAGE_ID = 'handlebars'

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

// Cache for helper suggestions
const helperSuggestionsCache = new Map<string, CachedHelperSuggestion[]>()

// Global flag to track if Monaco providers have been registered
let monacoProvidersRegistered = false

// Global reference to helpers for the Monaco providers
const globalHelpersRef: { current: TranslatedHelperDefinition[] } = { current: [] }

// Build cached helper suggestions (computed once per unique helpers array)
function getCachedHelperSuggestions(
  helpers: TranslatedHelperDefinition[],
  functionKind: number
): CachedHelperSuggestion[] {
  const cacheKey = helpers.map((h) => h.name).join(',')

  let cached = helperSuggestionsCache.get(cacheKey)
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
    helperSuggestionsCache.set(cacheKey, cached)
  }
  return cached
}

export interface RestormVariableInputBoxProps {
  value: string
  onChange: (value: string) => void
  variables: VariableDefinition[]
  helpers?: TranslatedHelperDefinition[]
  placeholder?: string
  /** Runtime ID of the variable (KeyValue.id) - used to receive resolved values from backend */
  variableId?: string
  id?: string
  className?: string
  style?: React.CSSProperties
  ariaLabel?: string
  onGoToDefinition?: (variableName: string) => void
}

export const RestormVariableInputBox: React.FC<RestormVariableInputBoxProps> = (props) => {
  const { t } = useTranslation()
  const {
    value,
    onChange,
    variables,
    helpers = [],
    placeholder,
    variableId,
    id,
    className,
    style,
    ariaLabel,
    onGoToDefinition
  } = props

  const editorRef = useRef<monacoEditor.editor.IStandaloneCodeEditor | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const helpersRef = useRef<TranslatedHelperDefinition[]>(helpers)
  const [showResolvedTooltip, setShowResolvedTooltip] = useState(false)
  const [resolvedValue, setResolvedValue] = useState<string | undefined>(undefined)
  const [availableVariables, setAvailableVariables] = useState<VariableDefinition[]>([])
  const [contextMenu, setContextMenu] = useState<{ visible: boolean; x: number; y: number }>({
    visible: false,
    x: 0,
    y: 0
  })

  // Suppress Monaco "Canceled" errors (normal when editor operations are interrupted)
  useEffect(() => {
    const handler = (event: PromiseRejectionEvent): void => {
      const reason = event.reason as unknown
      if (
        reason === 'Canceled' ||
        (reason !== null && typeof reason === 'object' && 'message' in reason && reason.message === 'Canceled')
      ) {
        event.preventDefault()
      }
    }
    window.addEventListener('unhandledrejection', handler)
    return () => { window.removeEventListener('unhandledrejection', handler) }
  }, [])

  // Keep helpers ref in sync via useEffect
  useEffect(() => {
    helpersRef.current = helpers
  }, [helpers])

  // Load initial resolved value and subscribe to updates from backend
  useEffect(() => {
    if (!variableId) return

    // Load initial value
    void (async () => {
      try {
        const results = await window.restorm.context.getAllTransformResults()
        const result = results[variableId]
        if (result) {
          setResolvedValue(result.transformedValue)
          // Convert contextUsed to VariableDefinition[]
          const varsFromContext: VariableDefinition[] = Object.entries(result.contextUsed).map(
            ([name, value]) => ({ name, value })
          )
          setAvailableVariables(varsFromContext)
        }
      } catch {
        // Ignore errors during initial load
      }
    })()

    // Subscribe to transformation updates (for resolved value tooltip)
    const unsubscribeTransform = window.restorm.context.onVariableTransformed((result: VariableTransformResult) => {
      if (result.variableId === variableId) {
        setResolvedValue(result.transformedValue)
      }
    })

    // Subscribe to available variables updates (for autocompletion)
    const unsubscribeVars = window.restorm.context.onAvailableVariables((result) => {
      if (result.variableId === variableId) {
        setAvailableVariables(prev => {
          const newVars = result.variables
          if (prev.length !== newVars.length) return newVars
          const hasChanges = newVars.some((v, i) => {
            const prevItem = prev[i]
            return prevItem && (prevItem.name !== v.name || prevItem.value !== v.value)
          })
          return hasChanges ? newVars : prev
        })
      }
    })

    return () => {
      unsubscribeTransform()
      unsubscribeVars()
    }
  }, [variableId])

  // Merge prop variables with backend variables (backend takes precedence for resolved values)
  const mergedVariables = React.useMemo(() => {
    // Start with backend variables (they have resolved values)
    const varMap = new Map<string, VariableDefinition>()
    for (const v of availableVariables) {
      varMap.set(v.name, v)
    }
    // Add prop variables that aren't already in the map
    for (const v of variables) {
      if (!varMap.has(v.name)) {
        varMap.set(v.name, v)
      }
    }
    return Array.from(varMap.values())
  }, [variables, availableVariables])

  const hasResolvedTooltip = Boolean(resolvedValue && resolvedValue !== value)

  // Go to definition handler
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
      onGoToDefinition?.(variableName)
    }
  }, [onGoToDefinition])

  // Cut action handler
  const handleCut = useCallback(() => {
    editorRef.current?.focus()
    editorRef.current?.trigger('keyboard', 'editor.action.clipboardCutAction', null)
  }, [])

  // Copy action handler
  const handleCopy = useCallback(() => {
    editorRef.current?.focus()
    editorRef.current?.trigger('keyboard', 'editor.action.clipboardCopyAction', null)
  }, [])

  // Paste action handler
  const handlePaste = useCallback(() => {
    void (async () => {
      editorRef.current?.focus()
      const text = await navigator.clipboard.readText()
      editorRef.current?.trigger('keyboard', 'paste', { text })
    })()
  }, [])

  // Context menu items - built inline to avoid ref access during render
  const baseItems: ContextMenuItem[] = [
    { id: 'cut', label: t('contextMenu.cut'), onClick: handleCut },
    { id: 'copy', label: t('contextMenu.copy'), onClick: handleCopy },
    { id: 'paste', label: t('contextMenu.paste'), onClick: handlePaste }
  ]

  const contextMenuItems: ContextMenuItem[] = onGoToDefinition
    ? [
        ...baseItems,
        { id: 'sep1', label: '', isSeparator: true },
        { id: 'goToDefinition', label: t('contextMenu.goToDefinition'), onClick: handleGoToDefinition }
      ]
    : baseItems

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY })
  }, [])

  const closeContextMenu = useCallback(() => {
    setContextMenu((prev) => ({ ...prev, visible: false }))
  }, [])

  // Monaco mount handler to add helpers completion and hover
  const handleMount = useCallback(
    (editor: monacoEditor.editor.IStandaloneCodeEditor, monaco: typeof monacoEditor) => {
      editorRef.current = editor

      // Register providers only once globally (not per component instance)
      if (!monacoProvidersRegistered) {
        monacoProvidersRegistered = true

        // Register helper completion provider (additional to base variable completion)
        monaco.languages.registerCompletionItemProvider(LANGUAGE_ID, {
          triggerCharacters: ['{'],
          provideCompletionItems(_model, position) {
            const range = {
              startLineNumber: position.lineNumber,
              endLineNumber: position.lineNumber,
              startColumn: position.column,
              endColumn: position.column
            }

            const cachedHelpers = getCachedHelperSuggestions(
              globalHelpersRef.current,
              monaco.languages.CompletionItemKind.Function
            )

            const suggestions = cachedHelpers.map((cached) => ({
              ...cached,
              label: cached.label as monacoEditor.languages.CompletionItemLabel,
              range
            }))

            return { suggestions, incomplete: true }
          }
        })

        // Register helper hover provider
        monaco.languages.registerHoverProvider(LANGUAGE_ID, {
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

            const innerContent = lineText.substring(openIndex + 2, closeIndex).trim()
            const name = innerContent.split(/\s+/)[0] ?? ''

            // Check if it's a helper (also check with # prefix for block helpers)
            const helperName = name.startsWith('#') ? name.slice(1) : name
            const helperMatch = globalHelpersRef.current.find((h) => h.name === helperName)

            if (helperMatch) {
              const range = new monaco.Range(
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
      }
    },
    []
  )

  // Update global helpers reference when helpers change
  useEffect(() => {
    globalHelpersRef.current = helpers
  }, [helpers])

  return (
    <>
      <div
        ref={containerRef}
        onMouseEnter={() => {
          if (hasResolvedTooltip) setShowResolvedTooltip(true)
        }}
        onMouseLeave={() => { setShowResolvedTooltip(false) }}
        onContextMenu={handleContextMenu}
        style={{ position: 'relative', width: '100%' }}
      >
        <VariableInputBox
          value={value}
          onChange={onChange}
          variables={mergedVariables}
          placeholder={placeholder}
          id={id}
          className={className}
          style={style}
          ariaLabel={ariaLabel}
          onMount={handleMount}
        />
      </div>
      {hasResolvedTooltip && (
        <Tooltip
          targetRef={containerRef}
          content={<span>{resolvedValue}</span>}
          show={showResolvedTooltip}
          placement="below"
        />
      )}
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
