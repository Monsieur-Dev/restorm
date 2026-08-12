import React, { useState, useEffect, forwardRef, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Editor, { type EditorProps, type OnMount } from '@monaco-editor/react'
import type * as monacoEditor from 'monaco-editor'
import './codeEditor.css'
import { bootstrapMonaco } from './monacoBootstrap'
import { filterHandlebarsMarkers } from './handlebarsTolerance'
import { findHandlebarsHighlightRanges, HANDLEBARS_INLINE_CLASS } from './handlebarsHighlight'

// Configure Monaco to use the locally-bundled package + locally-
// bundled web workers. Without this, `@monaco-editor/react`'s
// loader fetches Monaco from `cdn.jsdelivr.net` and asks it to
// fetch its workers from the same CDN — neither belongs in an
// Electron app that should run fully offline. Idempotent; module-
// level call so it fires before the first `<Editor>` mount.
bootstrapMonaco()

/**
 * Every editor method some holder may still call after `dispose()` — and
 * that Monaco answers with `InstantiationService has been disposed` (then a
 * `domNode` crash from the render it managed to schedule first).
 *
 * The critical holder is `@monaco-editor/react` ITSELF: under StrictMode's
 * dev-only disconnect→reconnect of a moved subtree (a KeyValueTable row
 * reorder), its cleanup disposes the editor but its `isEditorReady` state
 * stays true, so on reconnect it re-runs its own internal effects —
 * `setModel`, `executeEdits`, `updateOptions`, `onDidChangeModelContent`
 * re-subscription — against the corpse it still holds in a ref, and never
 * recreates the editor. No guard in OUR effects can intercept calls made
 * inside the library, so the corpse itself is defused: on dispose, each of
 * these methods is shadowed on the INSTANCE with an inert stub, which
 * protects every holder of the same object at once (the library, this
 * component, VariableInputBox, the host app).
 */
const DISPOSED_EDITOR_INERT_STUBS: Record<string, unknown> = {
  getModel: () => null,
  setModel: () => undefined,
  getValue: () => '',
  setValue: () => undefined,
  getOption: () => undefined,
  updateOptions: () => undefined,
  executeEdits: () => false,
  pushUndoStop: () => false,
  revealLine: () => undefined,
  saveViewState: () => null,
  restoreViewState: () => undefined,
  getPosition: () => null,
  getDomNode: () => null,
  layout: () => undefined,
  focus: () => undefined,
  hasTextFocus: () => false,
  trigger: () => undefined,
  getContribution: () => null,
  createDecorationsCollection: () => ({ set: () => undefined, clear: () => undefined, getRanges: () => [] }),
  addAction: () => ({ dispose: () => undefined }),
  addCommand: () => null,
  onDidChangeModelContent: () => ({ dispose: () => undefined }),
  onDidChangeModel: () => ({ dispose: () => undefined }),
  onKeyDown: () => ({ dispose: () => undefined }),
  onDidPaste: () => ({ dispose: () => undefined }),
  onDidDispose: () => ({ dispose: () => undefined })
}

/** Shadow the disposed editor's methods with inert stubs (own-property
 * assignment — the prototype stays untouched, other editors unaffected). */
function neuterDisposedEditor(editor: monacoEditor.editor.IStandaloneCodeEditor): void {
  const record = editor as unknown as Record<string, unknown>
  for (const [name, stub] of Object.entries(DISPOSED_EDITOR_INERT_STUBS)) {
    try {
      record[name] = stub
    } catch {
      // A frozen/accessor property refuses the shadow — leave that one; the
      // effect-level guards still cover this component's own calls.
    }
  }
}

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

  /**
   * Treat the document as a Handlebars TEMPLATE as well as a payload. Two
   * effects, both driven by the same construct finder:
   *
   * - `{{var}}`, `{{{raw}}}` and single-line `{{#each}}` blocks stop producing
   *   error markers even though Monaco's own validator cannot parse them.
   *   Genuine syntax errors are still reported.
   * - every construct is COLOURED, including one nested in a quoted string
   *   (`"{{petId}}"`), which no language tokenizer can reach.
   *
   * OFF by default — every editor showing a fixed document (a response body, a
   * schema, a config) must keep strict validation and its language's own
   * colours. Turn it on only where the user legitimately writes a template.
   *
   * @default false
   */
  tolerateHandlebars?: boolean
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
    goToDefinitionLabel,
    tolerateHandlebars = false,
    'data-testid': dataTestId,
    ...props
  },
  ref
) {
  const { t } = useTranslation()
  // Fall back to the built-in translation only when the host didn't pass a
  // label. The previous magic-string check (`=== 'Go to Definition'`) silently
  // ignored a host label that happened to equal the English default and broke
  // the moment that default string was reworded.
  const resolvedLabel = goToDefinitionLabel ?? t('codeEditor.goToDefinition')
  // Auto-detected theme (only used when theme prop is undefined)
  const [autoDetectedTheme, setAutoDetectedTheme] = useState<string>(getMonacoTheme)
  const [editorInstance, setEditorInstance] = useState<monacoEditor.editor.IStandaloneCodeEditor | null>(null)
  const [monacoInstance, setMonacoInstance] = useState<typeof monacoEditor | null>(null)
  /**
   * Bumped when the mounted editor gets disposed under this still-mounted
   * component (StrictMode's reconnect of a moved subtree) — used as the
   * `<Editor>` key. `@monaco-editor/react` never recreates an editor whose
   * `isEditorReady` already latched, so without the remount the row would
   * keep a defused-but-DEAD editor after a reorder. At a true unmount the
   * state update is a no-op on the gone component.
   */
  const [editorGeneration, setEditorGeneration] = useState(0)
  /** Content seed for a generation remount, captured (from the latest-value
   * ref) inside the dispose handler — a ref read during RENDER is what the
   * hooks rule forbids, and the frozen first-mount value would roll back
   * anything typed since. */
  const [remountSeed, setRemountSeed] = useState<string | null>(null)
  const goToDefinitionRef = useRef(onGoToDefinition)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /**
   * Editors whose `dispose()` already ran. StrictMode's dev-only
   * disconnect→reconnect of a moved subtree (a KeyValueTable row reorder)
   * re-runs the effects below while `editorInstance` still points at the
   * editor the disconnect just disposed — and any call on that instance
   * throws `InstantiationService has been disposed`, with a follow-up
   * `domNode` crash from renders scheduled before the dispose landed. The
   * `onDidDispose` hook in `handleMount` records the corpse here so every
   * effect and every DEFERRED callback (marker events, repaints) can bail
   * synchronously — the state-clearing `setEditorInstance(null)` alone is
   * not enough, because the re-run happens before that update renders.
   */
  const disposedEditorsRef = useRef(new WeakSet<object>())
  const lastValueRef = useRef<string | undefined>(props.value)
  const lastEventRef = useRef<monacoEditor.editor.IModelContentChangedEvent | undefined>(undefined)

  // Monaco is driven uncontrolled on our side: we pass an initial value via `defaultValue`
  // at mount, then manage sync manually. When the parent's `value` prop changes, we compare
  // it to the last value Monaco emitted through onChange:
  //   - If equal → React is just catching up to the user's typing, don't touch Monaco.
  //   - If different → external override (e.g. request switch), call editor.setValue imperatively.
  // This avoids @monaco-editor/react's built-in value-sync effect calling executeEdits with a
  // stale value during the CodeEditor debounce window, which resets the cursor when typing at
  // a cadence close to the debounce interval.
  const [initialValue] = useState<string>(props.value ?? props.defaultValue ?? '')
  const lastEmittedValueRef = useRef<string | undefined>(props.value)

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

  // Apply settings changes to live editor instance
  useEffect(() => {
    if (editorInstance && !disposedEditorsRef.current.has(editorInstance) && Object.keys(settingsOptions).length > 0) {
      editorInstance.updateOptions(settingsOptions)
    }
  }, [editorInstance, settingsOptions])

  // Effective theme: use prop if provided, otherwise auto-detected
  const currentTheme = theme ?? autoDetectedTheme
  const themeSource = theme === undefined ? 'auto' : 'prop'

  // Keep ref updated
  useEffect(() => {
    goToDefinitionRef.current = onGoToDefinition
  }, [onGoToDefinition])

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

  // Handlebars tolerance. Monaco's validators live in web workers that know
  // nothing about `{{ … }}`, and they can't be taught it — so the markers they
  // publish are pruned after the fact: whatever only exists because the document
  // is also a template is removed, everything else is left to squiggle.
  useEffect(() => {
    if (!tolerateHandlebars) return
    if (!editorInstance || !monacoInstance) return
    // The dispose→reconnect cycle re-runs this effect while the state still
    // holds the editor the disconnect just disposed — see disposedEditorsRef.
    if (disposedEditorsRef.current.has(editorInstance)) return

    const prune = (): void => {
      // Marker events arrive on Monaco's own schedule — re-check at every
      // deferred entry, not only when the effect armed.
      if (disposedEditorsRef.current.has(editorInstance)) return
      const model = editorInstance.getModel()
      if (!model) return
      const markers = monacoInstance.editor.getModelMarkers({ resource: model.uri })
      if (markers.length === 0) return
      const kept = filterHandlebarsMarkers(model.getValue(), markers, { languageId: model.getLanguageId() })
      if (kept.length === markers.length) return
      // `setModelMarkers` replaces ONE owner's whole set and a model can carry
      // several owners at once, so rewrite each owner with its own survivors.
      // This re-enters the listener below, but that pass filters an already
      // filtered set down to itself and bails on the length check above — so it
      // settles after exactly one extra round, no loop.
      for (const owner of new Set(markers.map((marker) => marker.owner))) {
        monacoInstance.editor.setModelMarkers(model, owner, kept.filter((marker) => marker.owner === owner))
      }
    }

    const subscription = monacoInstance.editor.onDidChangeMarkers((resources) => {
      if (disposedEditorsRef.current.has(editorInstance)) return
      const model = editorInstance.getModel()
      if (!model) return
      const uri = model.uri.toString()
      // The event is global to the Monaco instance: ignore the other editors'.
      if (!resources.some((resource) => resource.toString() === uri)) return
      prune()
    })

    // The first validation may already have landed before this effect ran.
    prune()

    return () => {
      subscription.dispose()
    }
  }, [tolerateHandlebars, editorInstance, monacoInstance])

  // Handlebars colouring. Monaco colours text through the model language's
  // tokenizer, and neither candidate can do this job: to the JSON grammar
  // `"{{petId}}"` is string text, and swapping in a Handlebars grammar would
  // stop the payload being validated at all. Decorations are applied by RANGE,
  // so they are language-agnostic — the constructs get their own colour on top
  // of whatever the language already painted, in a JSON body and an XML envelope
  // alike.
  useEffect(() => {
    if (!tolerateHandlebars) return
    if (!editorInstance || !monacoInstance) return
    // Same reconnect hazard as the marker effect above: creating a
    // decorations collection on a disposed editor is exactly the
    // `InstantiationService has been disposed` crash.
    if (disposedEditorsRef.current.has(editorInstance)) return

    const decorations = editorInstance.createDecorationsCollection([])

    const paint = (): void => {
      if (disposedEditorsRef.current.has(editorInstance)) return
      const model = editorInstance.getModel()
      if (!model) {
        decorations.clear()
        return
      }
      decorations.set(
        findHandlebarsHighlightRanges(model.getValue()).map((range) => ({
          range: new monacoInstance.Range(
            range.startLineNumber,
            range.startColumn,
            range.endLineNumber,
            range.endColumn
          ),
          options: {
            description: 'handlebars-construct',
            inlineClassName: HANDLEBARS_INLINE_CLASS,
            // The colour belongs to the construct as written. Typing at either
            // edge must not stretch the decoration over the neighbouring text
            // in the instant before the repaint below lands.
            stickiness: monacoInstance.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
          }
        }))
      )
    }

    // Every mutation repaints, including the imperative `setValue` an external
    // value override goes through.
    const contentSubscription = editorInstance.onDidChangeModelContent(paint)
    const modelSubscription = editorInstance.onDidChangeModel(paint)
    paint()

    return () => {
      contentSubscription.dispose()
      modelSubscription.dispose()
      decorations.clear()
    }
  }, [tolerateHandlebars, editorInstance, monacoInstance])

  // Expose ref
  React.useImperativeHandle(ref, () => ({
    editor: editorInstance,
    monaco: monacoInstance
  }), [editorInstance, monacoInstance])

  const handleMount: OnMount = (editor, monaco) => {
    const monacoTyped = monaco as typeof monacoEditor
    // Record the dispose the moment it happens, and drop the dead instance
    // from state so downstream effects re-run against null instead of a
    // corpse. The WeakSet is the synchronous half of the guard: the
    // reconnect's effect re-run happens BEFORE the state update renders.
    editor.onDidDispose(() => {
      disposedEditorsRef.current.add(editor)
      // Defuse the instance itself: `@monaco-editor/react`'s reconnect
      // effects call it through their own refs, out of this component's
      // reach — see DISPOSED_EDITOR_INERT_STUBS.
      neuterDisposedEditor(editor)
      setEditorInstance((current) => (current === editor ? null : current))
      // And remount the library component for a FRESH editor — the library
      // itself never recreates one once its ready-latch is set. Seed the
      // remount with the latest content (ref read is legal here, in an
      // event handler).
      setRemountSeed(lastValueRef.current ?? null)
      setEditorGeneration((generation) => generation + 1)
    })
    setEditorInstance(editor)
    setMonacoInstance(monacoTyped)

    if (dataTestId) {
      const domNode = editor.getDomNode()
      const textarea = domNode?.querySelector('textarea')
      if (textarea) {
        textarea.setAttribute('data-testid', `${dataTestId}-textarea`)
      }
    }

    // Register "Go to Definition" action for Handlebars variables
    editor.addAction({
      id: 'editor.action.goToVariableDefinition',
      label: resolvedLabel,
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
    onMount?.(editor, monaco)
    onEditorMount?.(editor, monaco)
  }

  const handleChange: EditorProps['onChange'] = (nextValue, ev) => {
    lastValueRef.current = nextValue
    lastEventRef.current = ev as monacoEditor.editor.IModelContentChangedEvent | undefined
    // Track the latest user-typed value so external value-prop changes can be distinguished
    // from React catching up.
    lastEmittedValueRef.current = nextValue

    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    if (changeDebounceMs <= 0) {
      props.onChange?.(nextValue, ev)
      return
    }

    debounceRef.current = setTimeout(() => {
      debounceRef.current = null
      if (lastEventRef.current) {
        props.onChange?.(lastValueRef.current, lastEventRef.current)
      }
    }, changeDebounceMs)
  }

  // Strip `value` from the props we forward to @monaco-editor/react so its internal
  // value-sync effect is fully inert.
  const { value: _propsValue, defaultValue: _propsDefaultValue, ...editorPropsWithoutValue } = props
  void _propsValue
  void _propsDefaultValue

  // Manual sync: push the value prop into Monaco only when it represents a true external
  // override (different from the last value the user typed). If a debounce is still pending,
  // Monaco's internal content is ahead of React state — skip the sync to avoid rolling back
  // unsaved keystrokes.
  useEffect(() => {
    if (!editorInstance) return
    if (disposedEditorsRef.current.has(editorInstance)) return
    if (props.value === undefined) return
    if (debounceRef.current !== null) return
    if (props.value === lastEmittedValueRef.current) return
    if (editorInstance.getValue() === props.value) {
      lastEmittedValueRef.current = props.value
      return
    }
    editorInstance.setValue(props.value)
    lastEmittedValueRef.current = props.value
  }, [editorInstance, props.value])

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
          {...editorPropsWithoutValue}
          // Remount on a mid-life dispose (see editorGeneration) so the
          // library builds a fresh editor instead of keeping the defused
          // corpse it refuses to recreate.
          key={editorGeneration}
          // Uncontrolled from @monaco-editor/react's point of view: omit `value` entirely so its
          // internal value-sync effect never runs. We push updates imperatively above.
          // A generation remount seeds the fresh editor with the LATEST
          // content (the frozen first-mount value would roll back typing).
          defaultValue={remountSeed ?? initialValue}
          options={{ ...(props.options ?? {}), ...settingsOptions }}
          theme={currentTheme}
          onChange={handleChange}
          onMount={handleMount}
          loading={null}
        />
      </div>
    </div>
  )
})
