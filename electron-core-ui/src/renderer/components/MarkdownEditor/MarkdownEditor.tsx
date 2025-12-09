import React from 'react'
import { MilkdownProvider, Milkdown, useEditor } from '@milkdown/react'
import { Crepe } from '@milkdown/crepe'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame-dark.css'
import './markdown.css'

export interface MarkdownEditorProps {
  /**
   * Initial markdown content to display in the editor.
   */
  initialValue?: string
}

const MarkdownEditorInner: React.FC<Required<Pick<MarkdownEditorProps, 'initialValue'>>> = ({ initialValue }) => {
  useEditor((root) => {
    return new Crepe({
      root,
      defaultValue: initialValue
    })
  }, [initialValue])

  return <Milkdown />
}

export const MarkdownEditor: React.FC<MarkdownEditorProps> = ({ initialValue }) => {
  return (
    <MilkdownProvider>
      <div
        style={{
          width: '100%',
          height: '100%',
          minHeight: 0,
          boxSizing: 'border-box',
        }}
      >
        <MarkdownEditorInner initialValue={initialValue ?? ''} />
      </div>
    </MilkdownProvider>
  )
}

export default MarkdownEditor


