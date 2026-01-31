import type React from 'react'
import type * as monacoEditor from 'monaco-editor'
import type { ContextMenuItem } from '../ContextMenu/ContextMenu'

export interface VariableDefinition {
  name: string
  value: string
  description?: string
}

export interface VariableInputBoxProps {
  value: string
  onChange: (value: string) => void
  variables: VariableDefinition[]
  /** Optional test id applied to the VariableInputBox root element. */
  'data-testid'?: string
  placeholder?: string
  id?: string
  className?: string
  style?: React.CSSProperties
  ariaLabel?: string
  /**
   * Override the editor language ID. Defaults to "handlebars".
   */
  languageId?: string
  /**
   * Disable the built-in Handlebars providers (completion + hover).
   */
  disableDefaultProviders?: boolean
  /**
   * Callback when the Monaco editor is mounted.
   * Allows extending the editor with custom providers.
   */
  onMount?: (
    editor: monacoEditor.editor.IStandaloneCodeEditor,
    monaco: typeof monacoEditor
  ) => void

  /**
   * Optional additional context menu items shown below cut/copy/paste.
   * A separator is automatically inserted when items are provided.
   */
  contextMenuItems?: ContextMenuItem[]
}
