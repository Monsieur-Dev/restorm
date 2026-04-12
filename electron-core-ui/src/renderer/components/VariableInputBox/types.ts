import type React from 'react'
import type * as monacoEditor from 'monaco-editor'
import type { ContextMenuItem } from '../ContextMenu/ContextMenu'

export interface VariableDefinition {
  name: string
  value: string
  description?: string | undefined
}

export interface VariableInputBoxProps {
  value: string
  onChange: (value: string) => void
  variables: VariableDefinition[]
  /** Optional test id applied to the VariableInputBox root element. */
  'data-testid'?: string | undefined
  placeholder?: string | undefined
  id?: string | undefined
  className?: string | undefined
  style?: React.CSSProperties | undefined
  ariaLabel?: string | undefined
  /**
   * Override the editor language ID. Defaults to "handlebars".
   */
  languageId?: string | undefined
  /**
   * Disable the built-in Handlebars providers (completion + hover).
   */
  disableDefaultProviders?: boolean | undefined
  /**
   * Callback when the Monaco editor is mounted.
   * Allows extending the editor with custom providers.
   */
  onMount?: ((
    editor: monacoEditor.editor.IStandaloneCodeEditor,
    monaco: typeof monacoEditor
  ) => void) | undefined

  /**
   * Optional additional context menu items shown below cut/copy/paste.
   * A separator is automatically inserted when items are provided.
   */
  contextMenuItems?: ContextMenuItem[] | undefined

  /**
   * Forwarded to the underlying CodeEditor. When 0, `onChange` fires synchronously
   * on every keystroke (keeps the React state in lockstep with Monaco's internal
   * content, useful for single-line inputs). Defaults to the CodeEditor default.
   */
  changeDebounceMs?: number | undefined
}
