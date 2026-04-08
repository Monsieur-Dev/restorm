import React, { useState, useEffect, forwardRef, useRef, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Editor, { type EditorProps, type OnMount } from '@monaco-editor/react'
import type * as monacoEditor from 'monaco-editor'
import { shouldRestoreMouseSelection } from './selectionGuard'
import './codeEditor.css'

/**
 * Extract a Handlebars variable name at the given position in text.
 * Returns the variable name if cursor is inside {{variableName}}, otherwise null.
 */
function getVariableAtPosition(
  model: monacoEditor.editor.ITextModel,
  position: monacoEditor.Position
): string | null {
  const line = model.getLineContent(position.lineNumber)
  const col = position.column - 1 // 0-based

  // Find all {{...}} in the line
  const regex = /\{\{([^{}]+)\}\}/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(line)) !== null) {
    const start = match.index
    const end = start + match[0].length
    if (col >= start && col <= end) {
      // Cursor is inside this variable reference
      const varName = match[1]
      return varName ? varName.trim() : null
    }
  }
  return null
}

/**
 * Extended props for CodeEditor component
 * Inherits all props from Monaco Editor
 */
export interface CodeEditorProps extends Omit<EditorProps, 'theme'> {
  /** Optional test id applied to the root element. */
  'data-testid'?: string
  /**
   * Override the automatic theme detection
   * If not provided, the theme will be automatically determined based on the current app theme
   * @default auto-detected from data-theme attribute
   */
  theme?: string

  /**
   * Debounce delay (ms) before emitting onChange to parent. Default: 200ms.
   */
  changeDebounceMs?: number

  /**
   * Callback fired when the editor is mounted
   * This is an alias for onMount to maintain consistency
   */
  onEditorMount?: OnMount

  /**
   * When true (default), applies user editor settings (fontSize, fontFamily, etc.)
   * from the SettingsService. Set to false for compact editors like URL inputs
   * and variable input boxes.
   */
  applyEditorSettings?: boolean

  /**
   * Callback fired when "Go to definition" is triggered on a variable.
   * The variable name is extracted from Handlebars syntax {{variableName}}.
   */
  onGoToDefinition?: (variableName: string) => void

  /**
   * Label for the "Go to definition" action in the context menu.
   * @default Uses i18n translation key 'codeEditor.goToDefinition'
   */
  goToDefinitionLabel?: string
}

/**
 * Reference type for CodeEditor component
 */
export interface CodeEditorRef {
  /** The Monaco editor instance */
  editor: monacoEditor.editor.IStandaloneCodeEditor | null
  /** The Monaco namespace */
  monaco: typeof monacoEditor | null
}

/**
 * Detect if the current theme is dark based on data-theme attribute
 */
function isDarkTheme(): boolean {
  if (typeof document === 'undefined') return true
  const themeAttr = document.documentElement.getAttribute('data-theme') ?? 'dark'
  return themeAttr === 'dark' || themeAttr === 'hcDark'
}

/**
 * Get Monaco theme name based on current app theme
 */
function getMonacoTheme(): string {
  return isDarkTheme() ? 'vs-dark' : 'vs'
}

/**
 * CodeEditor component that wraps Monaco Editor with automatic theme synchronization
 *
 * This component provides the same API as Monaco Editor from @monaco-editor/react,
 * but automatically switches between vs-dark and vs themes based on the application's
 * current theme (detected via data-theme attribute on document.documentElement).
 *
 * @example
 * ```tsx
 * // Basic usage - theme auto-detected
 * <CodeEditor
 *   value={code}
 *   language="typescript"
 *   onChange={(value) => setCode(value ?? '')}
 * />
 *
 * // With custom options
 * <CodeEditor
 *   value={json}
 *   language="json"
 *   height="400px"
 *   options={{
 *     minimap: { enabled: false },
 *     wordWrap: 'on',
 *     readOnly: true
 *   }}
 * />
 *
 * // Override theme manually
 * <CodeEditor
 *   value={code}
 *   language="javascript"
 *   theme="hc-black"
 * />
 * ```
 */
export const CodeEditor = forwardRef<CodeEditorRef, CodeEditorProps>(function CodeEditor(
  {
    theme,
    changeDebounceMs = 200,
    applyEditorSettings = true,
    onMount,
    onEditorMount,
    onGoToDefinition,
    goToDefinitionLabel = 'Go to Definition',
    'data-testid': dataTestId,
    ...props
  },
  ref
) {
  const { t } = useTranslation()
  const resolvedLabel = goToDefinitionLabel === 'Go to Definition' ? t('codeEditor.goToDefinition') : goToDefinitionLabel
  // Auto-detected theme (only used when theme prop is undefined)
  const [autoDetectedTheme, setAutoDetectedTheme] = useState<string>(getMonacoTheme)
  const [editorInstance, setEditorInstance] = useState<monacoEditor.editor.IStandaloneCodeEditor | null>(null)
  const [monacoInstance, setMonacoInstance] = useState<typeof monacoEditor | null>(null)
  const goToDefinitionRef = useRef(onGoToDefinition)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastValueRef = useRef<string | undefined>(props.value)
  const lastEventRef = useRef<monacoEditor.editor.IModelContentChangedEvent | undefined>(undefined)
  const onChangeRef = useRef(props.onChange)
  const changeDebounceMsRef = useRef(changeDebounceMs)
  const onMountRef = useRef(onMount)
  const onEditorMountRef = useRef(onEditorMount)
  const dataTestIdRef = useRef(dataTestId)
  const resolvedLabelRef = useRef(resolvedLabel)
  const isMouseDownRef = useRef(false)

  // Editor settings from SettingsService (fontSize, fontFamily, wordWrap, minimap, lineNumbers)
  const [editorSettings, setEditorSettings] = useState<Record<string, unknown>>({})

  useEffect(() => {
    if (!applyEditorSettings) return
    const w = window as unknown as Record<string, unknown>
    const api = w['api'] as { settings?: { get: (k: string) => Promise<unknown>; onSettingChanged: (cb: (k: string, v: unknown) => void) => () => void } } | undefined
    const settingsApi = api?.settings
    if (!settingsApi) return

    // Load initial values
    const keys = [
      'appearance.editor:fontSize',
      'appearance.editor:fontFamily',
      'appearance.editor:wordWrap',
      'appearance.editor:minimap',
      'appearance.editor:lineNumbers'
    ]
    const loadAll = async (): Promise<void> => {
      const entries: Record<string, unknown> = {}
      for (const k of keys) {
        entries[k] = await settingsApi.get(k)
      }
      setEditorSettings(entries)
    }
    void loadAll()

    // Listen for changes
    const cleanup = settingsApi.onSettingChanged((key: string, value: unknown) => {
      if (keys.includes(key)) {
        setEditorSettings(prev => ({ ...prev, [key]: value }))
      }
    })
    return cleanup
  }, [applyEditorSettings])

  // Merge editor settings into Monaco options
  const settingsOptions = useMemo((): Record<string, unknown> => {
    const opts: Record<string, unknown> = {}
    const fs = editorSettings['appearance.editor:fontSize']
    if (typeof fs === 'number') opts['fontSize'] = fs
    const ff = editorSettings['appearance.editor:fontFamily']
    if (typeof ff === 'string') opts['fontFamily'] = ff
    const ww = editorSettings['appearance.editor:wordWrap']
    if (typeof ww === 'boolean') opts['wordWrap'] = ww ? 'on' : 'off'
    const mm = editorSettings['appearance.editor:minimap']
    if (typeof mm === 'boolean') opts['minimap'] = { enabled: mm }
    const ln = editorSettings['appearance.editor:lineNumbers']
    if (typeof ln === 'boolean') opts['lineNumbers'] = ln ? 'on' : 'off'
    return opts
  }, [editorSettings])

  // Memoize merged options to prevent unnecessary updateOptions calls during parent re-renders
  const mergedOptions = useMemo(
    () => ({ ...(props.options ?? {}), ...settingsOptions }),
    [props.options, settingsOptions]
  )

  // Apply settings changes to live editor instance
  useEffect(() => {
    if (editorInstance && Object.keys(settingsOptions).length > 0) {
      editorInstance.updateOptions(settingsOptions)
    }
  }, [editorInstance, settingsOptions])

  // Effective theme: use prop if provided, otherwise auto-detected
  const currentTheme = theme ?? autoDetectedTheme
  const themeSource = theme === undefined ? 'auto' : 'prop'

  // Keep refs updated for stable callbacks
  useEffect(() => {
    goToDefinitionRef.current = onGoToDefinition
  }, [onGoToDefinition])

  useEffect(() => {
    onChangeRef.current = props.onChange
    changeDebounceMsRef.current = changeDebounceMs
    onMountRef.current = onMount
    onEditorMountRef.current = onEditorMount
    dataTestIdRef.current = dataTestId
    resolvedLabelRef.current = resolvedLabel
  }, [props.onChange, changeDebounceMs, onMount, onEditorMount, dataTestId, resolvedLabel])

  useEffect(() => {
    lastValueRef.current = props.value
  }, [props.value])

  // Clear pending debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [])

  // Watch for theme changes in the document (only when theme prop is not set)
  useEffect(() => {
    if (theme !== undefined) return
    if (typeof document === 'undefined') return

    const handleThemeChange = (): void => {
      const newTheme = getMonacoTheme()
      setAutoDetectedTheme(newTheme)
    }

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' && m.attributeName === 'data-theme') {
          handleThemeChange()
        }
      }
    })

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    })

    // Sync initial value
    handleThemeChange()

    return () => {
      observer.disconnect()
    }
  }, [theme])

  // During a mouse drag, Monaco can emit a spurious non-mouse selection update
  // after syncing its hidden textarea. Preserve the last genuine mouse selection
  // and restore it if such an update collapses the drag selection.
  useEffect(() => {
    if (!editorInstance || !monacoInstance) return
    const domNode = editorInstance.getDomNode()
    if (!domNode) return
    const hiddenTextarea = domNode.querySelector('textarea')

    let restoringSelection = false
    let lastGoodMouseSelection: {
      anchorLine: number
      anchorColumn: number
      activeLine: number
      activeColumn: number
      isEmpty: boolean
    } | null = null

    const onMouseDown = (): void => {
      isMouseDownRef.current = true
      lastGoodMouseSelection = null
    }

    const onMouseUp = (): void => {
      isMouseDownRef.current = false
    }

    domNode.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mouseup', onMouseUp)

    const selectionDisposable = editorInstance.onDidChangeCursorSelection((e) => {
      if (
        isMouseDownRef.current &&
        e.source === 'mouse' &&
        hiddenTextarea instanceof HTMLTextAreaElement
      ) {
        lastGoodMouseSelection = {
          anchorLine: e.selection.selectionStartLineNumber,
          anchorColumn: e.selection.selectionStartColumn,
          activeLine: e.selection.positionLineNumber,
          activeColumn: e.selection.positionColumn,
          isEmpty: e.selection.isEmpty()
        }
      }

      if (!isMouseDownRef.current || restoringSelection) return

      const mouseSelectionToRestore = lastGoodMouseSelection

      if (shouldRestoreMouseSelection({
        isMouseDown: isMouseDownRef.current,
        source: e.source,
        currentSelection: {
          anchorLine: e.selection.selectionStartLineNumber,
          anchorColumn: e.selection.selectionStartColumn,
          activeLine: e.selection.positionLineNumber,
          activeColumn: e.selection.positionColumn,
          isEmpty: e.selection.isEmpty()
        },
        lastGoodMouseSelection: mouseSelectionToRestore
      }) && mouseSelectionToRestore) {
        restoringSelection = true
        editorInstance.setSelection(new monacoInstance.Selection(
          mouseSelectionToRestore.anchorLine,
          mouseSelectionToRestore.anchorColumn,
          mouseSelectionToRestore.activeLine,
          mouseSelectionToRestore.activeColumn
        ))
        restoringSelection = false
      }
    })

    return () => {
      domNode.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mouseup', onMouseUp)
      selectionDisposable.dispose()
    }
  }, [editorInstance, monacoInstance])

  // Expose ref
  React.useImperativeHandle(ref, () => ({
    editor: editorInstance,
    monaco: monacoInstance
  }), [editorInstance, monacoInstance])

  const handleMount: OnMount = useCallback((editor, monaco) => {
    const monacoTyped = monaco as typeof monacoEditor
    setEditorInstance(editor)
    setMonacoInstance(monacoTyped)

    const testId = dataTestIdRef.current
    if (testId) {
      const domNode = editor.getDomNode()
      const textarea = domNode?.querySelector('textarea')
      if (textarea) {
        textarea.setAttribute('data-testid', `${testId}-textarea`)
      }
    }

    // Register "Go to Definition" action for Handlebars variables
    editor.addAction({
      id: 'editor.action.goToVariableDefinition',
      label: resolvedLabelRef.current,
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1,
      keybindings: [monacoTyped.KeyMod.CtrlCmd | monacoTyped.KeyCode.F12],
      run: (ed) => {
        const model = ed.getModel()
        const position = ed.getPosition()
        if (!model || !position) return

        const variableName = getVariableAtPosition(model, position)
        if (variableName && goToDefinitionRef.current) {
          goToDefinitionRef.current(variableName)
        }
      }
    })

    // Call user-provided callbacks
    onMountRef.current?.(editor, monaco)
    onEditorMountRef.current?.(editor, monaco)
  }, [])

  const handleChange: EditorProps['onChange'] = useCallback((nextValue: string | undefined, ev: monacoEditor.editor.IModelContentChangedEvent) => {
    lastValueRef.current = nextValue
    lastEventRef.current = ev

    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    if (changeDebounceMsRef.current <= 0) {
      onChangeRef.current?.(nextValue, ev)
      return
    }

    debounceRef.current = setTimeout(() => {
      if (lastEventRef.current) {
        onChangeRef.current?.(lastValueRef.current, lastEventRef.current)
      }
    }, changeDebounceMsRef.current)
  }, [])

  return (
    <div
      className="ecui-code-editor"
      style={{ height: props.height, width: props.width }}
      {...(dataTestId && { 'data-testid': dataTestId })}
      data-theme-source={themeSource}
      data-resolved-theme={currentTheme}
    >
      <div style={{ width: '100%', height: '100%' }} {...(dataTestId && { 'data-testid': `${dataTestId}-monaco` })}>
        <Editor
          {...props}
          options={mergedOptions}
          theme={currentTheme}
          onChange={handleChange}
          onMount={handleMount}
          loading={null}
        />
      </div>
    </div>
  )
})

export default CodeEditor
