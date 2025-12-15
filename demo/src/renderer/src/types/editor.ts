import type { EditorTab } from 'electron-core-ui/renderer'

/**
 * Extended EditorTab type for Demo that includes content
 */
export interface DemoEditorTab extends EditorTab {
  /**
   * Content of the tab as a string (used for Monaco editor)
   */
  content?: string
  /**
   * String representation of the title for serialization purposes (IPC, logs, etc.).
   * Inherited from EditorTab, but explicitly declared here for TypeScript recognition.
   */
  titleString?: string
}
