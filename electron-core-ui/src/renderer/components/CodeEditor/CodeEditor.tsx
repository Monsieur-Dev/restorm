import React, { useState, useEffect, forwardRef } from 'react'
import Editor, { type EditorProps, type Monaco, type OnMount } from '@monaco-editor/react'
import type * as monacoEditor from 'monaco-editor'

/**
 * Extended props for CodeEditor component
 * Inherits all props from Monaco Editor
 */
export interface CodeEditorProps extends Omit<EditorProps, 'theme'> {
  /**
   * Override the automatic theme detection
   * If not provided, the theme will be automatically determined based on the current app theme
   * @default auto-detected from data-theme attribute
   */
  theme?: string
  
  /**
   * Callback fired when the editor is mounted
   * This is an alias for onMount to maintain consistency
   */
  onEditorMount?: OnMount
}

/**
 * Reference type for CodeEditor component
 */
export interface CodeEditorRef {
  /** The Monaco editor instance */
  editor: monacoEditor.editor.IStandaloneCodeEditor | null
  /** The Monaco namespace */
  monaco: Monaco | null
}

/**
 * Detect if the current theme is dark based on data-theme attribute
 */
function isDarkTheme(): boolean {
  if (typeof document === 'undefined') return true
  const themeAttr = document.documentElement.getAttribute('data-theme') ?? 'dark'
  return themeAttr === 'dark' || themeAttr === 'hcDark' || themeAttr === 'hc'
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
  { theme, onMount, onEditorMount, ...props },
  ref
) {
  const [currentTheme, setCurrentTheme] = useState<string>(() => theme ?? getMonacoTheme())
  const [editorInstance, setEditorInstance] = useState<monacoEditor.editor.IStandaloneCodeEditor | null>(null)
  const [monacoInstance, setMonacoInstance] = useState<Monaco | null>(null)

  // Sync theme when prop changes
  useEffect(() => {
    if (theme !== undefined) {
      setCurrentTheme(theme)
    }
  }, [theme])

  // Watch for theme changes in the document
  useEffect(() => {
    // If theme is manually specified, don't auto-detect
    if (theme !== undefined) return
    if (typeof document === 'undefined') return

    const handleThemeChange = (): void => {
      const newTheme = getMonacoTheme()
      setCurrentTheme(newTheme)
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

  // Expose ref
  React.useImperativeHandle(ref, () => ({
    editor: editorInstance,
    monaco: monacoInstance
  }), [editorInstance, monacoInstance])

  const handleMount: OnMount = (editor, monaco) => {
    setEditorInstance(editor)
    setMonacoInstance(monaco)
    
    // Call user-provided callbacks
    onMount?.(editor, monaco)
    onEditorMount?.(editor, monaco)
  }

  return (
    <Editor
      {...props}
      theme={currentTheme}
      onMount={handleMount}
    />
  )
})

export default CodeEditor

