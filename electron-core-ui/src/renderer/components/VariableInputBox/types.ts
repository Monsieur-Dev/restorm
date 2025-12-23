import type React from 'react'
import type * as monacoEditor from 'monaco-editor'

export interface VariableDefinition {
  name: string
  value: string
  description?: string
}

export interface VariableInputBoxProps {
  value: string
  onChange: (value: string) => void
  variables: VariableDefinition[]
  placeholder?: string
  id?: string
  className?: string
  style?: React.CSSProperties
  ariaLabel?: string
  /**
   * Callback when the Monaco editor is mounted.
   * Allows extending the editor with custom providers.
   */
  onMount?: (
    editor: monacoEditor.editor.IStandaloneCodeEditor,
    monaco: typeof monacoEditor
  ) => void
}
