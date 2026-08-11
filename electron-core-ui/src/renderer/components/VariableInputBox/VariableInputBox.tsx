import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type * as monacoEditor from 'monaco-editor'
import type { VariableInputBoxProps, VariableDefinition } from './types'
import { defaultInputBoxStyles } from '../InputBox/types'
import { CodeEditor } from '../CodeEditor/CodeEditor'
import { ContextMenu, type ContextMenuItem } from '../ContextMenu/ContextMenu'
import { handlebarsReference, extractVariableName } from './handlebarsReference'
import '../InputBox/inputBox.css'
import './variableInputBox.css'

const LANGUAGE_ID = 'handlebars'

interface ModelData {
  variables: VariableDefinition[]
}

// Use window to persist state across hot reloads
const globalKey = '__variableInputBoxProviders__'
interface ProviderState {
  languageConfigured: boolean
  completionProviderDisposable: monacoEditor.IDisposable | null
  hoverProviderDisposable: monacoEditor.IDisposable | null
  /** Ref-count of mounted inputs holding the global unhandledrejection handler. */
  cancellationHandlerRefs: number
  /** The registered handler, kept so it can be removed once refs hit zero. */
  cancellationHandler: ((event: PromiseRejectionEvent) => void) | null
  modelDataMap: WeakMap<monacoEditor.editor.ITextModel, ModelData>
}

function getProviderState(): ProviderState {
  const win = window as unknown as Record<string, ProviderState | undefined>
  win[globalKey] ??= {
    languageConfigured: false,
    completionProviderDisposable: null,
    hoverProviderDisposable: null,
    cancellationHandlerRefs: 0,
    cancellationHandler: null,
    modelDataMap: new WeakMap()
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
  const { t } = useTranslation()
  const {
    value,
    onChange,
    variables,
    'data-testid': dataTestId,
    placeholder,
    id,
    className,
    style,
    ariaLabel,
    languageId,
    disableDefaultProviders = false,
    onMount: onMountProp,
    contextMenuItems: extraContextMenuItems = [],
    changeDebounceMs
  } = props
  const effectiveLanguageId = languageId ?? LANGUAGE_ID
  const editorRef = useRef<monacoEditor.editor.IStandaloneCodeEditor | null>(null)
  const variablesRef = useRef<VariableDefinition[]>(variables)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [editorMounted, setEditorMounted] = useState(false)
  // Placeholder gate: tracks whether the EDITOR currently holds text. Keyed
  // off the live edits (and re-synced when the `value` prop changes) rather
  // than the prop alone — a consumer that funnels onChange into a non-React
  // store (e.g. a reactive proxy) never re-renders, so `value` stays stale
  // and a prop-gated placeholder would sit on top of the typed text.
  const [editorIsEmpty, setEditorIsEmpty] = useState(value === '')
  useEffect(() => { setEditorIsEmpty(value === '') }, [value])
  const [contextMenu, setContextMenu] = useState<{ visible: boolean; x: number; y: number }>({
    visible: false,
    x: 0,
    y: 0
  })

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

  const contextMenuItems = useMemo<ContextMenuItem[]>(() => {
    const base: ContextMenuItem[] = [
      { id: 'cut', label: t('contextMenu.cut'), onClick: handleCut },
      { id: 'copy', label: t('contextMenu.copy'), onClick: handleCopy },
      { id: 'paste', label: t('contextMenu.paste'), onClick: () => { void handlePaste() } }
    ]

    if (extraContextMenuItems.length === 0) {
      return base
    }

    return [
      ...base,
      { id: 'sep-extra', label: '', isSeparator: true },
      ...extraContextMenuItems
    ]
  }, [t, handleCut, handleCopy, handlePaste, extraContextMenuItems])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY })
  }, [])

  const closeContextMenu = useCallback(() => {
    setContextMenu(prev => ({ ...prev, visible: false }))
  }, [])

  // Hide the suggest + hover widgets that `fixedOverflowWidgets` (see
  // `editorOptions` below) reparents onto `document.body`. Both widgets live
  // OUTSIDE this component's own DOM subtree once reparented, so they don't
  // naturally disappear when a workbench tab is switched away from — the tab
  // slot only toggles `display:none` on its container, it never unmounts the
  // editor (see `TabSlot` in electron-core-ui's Workbench). Without this,
  // a suggestion/hover popup opened in one request keeps floating over
  // whichever request is now active.
  const hideOverflowWidgets = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    // Public editor command (registered by Monaco's suggest contribution) —
    // safe to call even when no suggestion is showing.
    editor.trigger('electron-core-ui', 'hideSuggestWidget', {})
    // No public command exists for the hover widget; reach its contribution
    // directly. `hideContentHover` is a no-op when nothing is showing.
    editor
      .getContribution<monacoEditor.editor.IEditorContribution & { hideContentHover?: () => void }>(
        'editor.contrib.contentHover'
      )
      ?.hideContentHover?.()
  }, [])

  // Keep refs in sync
  variablesRef.current = variables

  // Update modelDataMap when variables change AND editor is mounted
  useEffect(() => {
    if (disableDefaultProviders || effectiveLanguageId !== LANGUAGE_ID) return
    if (!editorMounted) return
    const model = editorRef.current?.getModel()
    if (model) {
      getProviderState().modelDataMap.set(model, { variables })
    }
  }, [variables, editorMounted, disableDefaultProviders, effectiveLanguageId])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const state = getProviderState()
    // Ref-count the global handler so it's added on the first mounted input and
    // REMOVED when the last unmounts — otherwise it leaked for the app's
    // lifetime, permanently swallowing every 'Canceled' rejection app-wide.
    if (state.cancellationHandlerRefs === 0) {
      const handler = (event: PromiseRejectionEvent): void => {
        if (isMonacoCancellationError(event.reason)) {
          event.preventDefault()
        }
      }
      window.addEventListener('unhandledrejection', handler)
      state.cancellationHandler = handler
    }
    state.cancellationHandlerRefs += 1

    return () => {
      state.cancellationHandlerRefs -= 1
      if (state.cancellationHandlerRefs <= 0 && state.cancellationHandler) {
        window.removeEventListener('unhandledrejection', state.cancellationHandler)
        state.cancellationHandler = null
        state.cancellationHandlerRefs = 0
      }
    }
  }, [])

  // A hidden workbench tab slot never fires `mouseleave`/blur on this
  // editor — the container just stops intersecting the viewport. Watch for
  // that (also covers scrolling the field itself out of view) and hide any
  // body-attached suggest/hover widget the moment it happens.
  useEffect(() => {
    const el = containerRef.current
    // jsdom (unit tests) doesn't implement IntersectionObserver; every real
    // runtime target (Electron/browser) does.
    if (!el || typeof IntersectionObserver === 'undefined') return undefined
    const observer = new IntersectionObserver((entries) => {
      if (entries.every((entry) => !entry.isIntersecting)) {
        hideOverflowWidgets()
      }
    })
    observer.observe(el)
    return () => { observer.disconnect() }
  }, [hideOverflowWidgets])

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
      // The companion `overflowWidgetsDomNode: document.body` reparents the
      // overflowing widget onto the body — without it, a transformed ancestor
      // (e.g. a React Flow viewport using `transform: translate()/scale()`)
      // becomes the containing block for `position: fixed`, anchoring the
      // suggest popup hundreds of pixels off the cursor.
      fixedOverflowWidgets: true as const,
      ...(typeof document !== 'undefined' ? { overflowWidgetsDomNode: document.body } : {}),
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
        showInlineDetails: true,
        detailsVisible: true,
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

    // Undebounced emptiness tracking: the `onChange` prop is debounced, so
    // gating the placeholder there alone would leave it painted over the
    // first typed characters for the debounce window.
    editor.onDidChangeModelContent(() => {
      setEditorIsEmpty(editor.getValue() === '')
    })
    setEditorIsEmpty(editor.getValue() === '')

    const state = getProviderState()

    // Monaco's theme rules (`.monaco-editor .suggest-widget …`) are scoped to
    // the editor root. When `overflowWidgetsDomNode` reparents the popups onto
    // `body`, those selectors no longer match — the widget renders unstyled.
    // Copying the editor's own theme classes (`monaco-editor`, `vs` /
    // `vs-dark`, …) onto **every** body-attached `overflowingContentWidgets`
    // container makes every scoped rule resolve again. Stamping all of them
    // (not just the first) matters because Monaco creates one container per
    // editor instance, so a later editor's onMount must also stamp the
    // earlier instance's container (and vice-versa) — otherwise the second
    // editor's suggest popup renders unstyled.
    if (typeof document !== 'undefined') {
      const editorEl = editor.getDomNode()
      if (editorEl) {
        const containers = document.body.querySelectorAll(':scope > .overflowingContentWidgets')
        for (const container of containers) {
          for (const cls of Array.from(editorEl.classList)) container.classList.add(cls)
        }
      }
    }

    if (!disableDefaultProviders && effectiveLanguageId === LANGUAGE_ID) {
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

            const data = getProviderState().modelDataMap.get(model) ?? { variables: [] }
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
                insertText: handlebarsReference(v.name),
                documentation: v.description ?? v.value,
                detail: 'variable',
                sortText: `0_${v.name}`,
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

            // Extract the variable name between {{ and }} — a quoted segment
            // (`'a b'`) is one whitespace-bearing name, otherwise the first token.
            const innerContent = lineText.substring(openIndex + 2, closeIndex)
            const name = extractVariableName(innerContent)

            const data = getProviderState().modelDataMap.get(model) ?? { variables: [] }

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

            return { contents: [] }
          }
        })
    }

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

    // Disable Monaco's find-next / find-previous shortcuts inside this
    // single-line editor. The default F3 / Shift+F3 wiring opens
    // Monaco's find widget, which leaks into the compact input host —
    // there is no meaningful navigation target inside a one-line field.
    editor.addCommand(monacoInstance.KeyCode.F3, () => { /* no-op */ })
    editor.addCommand(monacoInstance.KeyMod.Shift | monacoInstance.KeyCode.F3, () => { /* no-op */ })

    // Strip newlines from pasted content so multi-line pastes collapse to a single line
    editor.onDidPaste(() => {
      const model = editor.getModel()
      if (!model) return
      const content = model.getValue()
      if (content.includes('\n') || content.includes('\r')) {
        const cleaned = content.replace(/[\r\n]+/g, ' ')
        model.setValue(cleaned)
      }
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
        variables: variablesRef.current
      })
    }

    // Belt-and-suspenders for `hideOverflowWidgets` above: covers a click
    // straight to another control WITHOUT a tab switch (the container never
    // loses intersection, so the IntersectionObserver never fires). Widget-
    // level blur (not text-input blur) so keyboard navigation inside an open
    // suggestion list doesn't get treated as leaving the field.
    editor.onDidBlurEditorWidget(() => { hideOverflowWidgets() })

    // Signal that editor is mounted so useEffect can update variables
    setEditorMounted(true)

    if (ariaLabel) {
      editor.updateOptions({ ariaLabel })
    }

    // Call the onMount callback if provided
    onMountProp?.(editor, monacoInstance)
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
          height: 28,
          maxHeight: 28,
          overflow: 'hidden',
          ...(style ?? {})
        }}
        ref={containerRef}
        onContextMenu={handleContextMenu}
        {...(dataTestId && {
          'data-testid': dataTestId,
          'data-language-id': effectiveLanguageId,
          'data-disable-default-providers': disableDefaultProviders ? 'true' : 'false'
        })}
      >
        <div className="ibwrapper" style={{ display: 'flex', alignItems: 'center' }}>
          {placeholder && editorIsEmpty && (
            <div
              style={{
                position: 'absolute',
                top: 5,
                left: 8,
                right: 8,
                // Render above the Monaco editor layer: the editor paints an
                // opaque background, so without this the absolutely-positioned
                // placeholder is occluded and only a faint sliver bleeds through
                // (an inconsistent smudge per placeholder text). `pointerEvents:
                // none` keeps clicks/typing flowing to the editor underneath.
                zIndex: 1,
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
            {...(dataTestId && { 'data-testid': `${dataTestId}-editor` })}
          >
            <CodeEditor
              value={value}
              onChange={(v) => {
                setEditorIsEmpty((v ?? '') === '')
                onChange(v ?? '')
              }}
              language={effectiveLanguageId}
              height={20}
              options={editorOptions}
              onMount={handleMount}
              applyEditorSettings={false}
              {...(changeDebounceMs !== undefined && { changeDebounceMs })}
              {...(dataTestId && { 'data-testid': `${dataTestId}-codeeditor` })}
            />
          </div>
        </div>
      </div>
      <ContextMenu
        {...(dataTestId && { 'data-testid': `${dataTestId}-contextmenu` })}
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
