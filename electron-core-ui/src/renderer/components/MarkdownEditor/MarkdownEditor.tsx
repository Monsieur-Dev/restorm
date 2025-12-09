import React, { useEffect, useState } from 'react'
import { MilkdownProvider, Milkdown, useEditor } from '@milkdown/react'
import { Crepe } from '@milkdown/crepe'
import '@milkdown/crepe/theme/common/style.css'
import './markdown.css'

export interface MarkdownEditorProps {
  /**
   * Initial markdown content to display in the editor.
   */
  initialValue?: string
}

/**
 * Determine if the current theme is dark based on data-theme attribute
 */
function useIsDarkTheme(): boolean {
  const [isDark, setIsDark] = useState(() => {
    const themeType = document.documentElement.getAttribute('data-theme')
    return themeType === 'dark' || themeType === 'hcDark'
  })

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const themeType = document.documentElement.getAttribute('data-theme')
      setIsDark(themeType === 'dark' || themeType === 'hcDark')
    })

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    })

    return () => {
      observer.disconnect()
    }
  }, [])

  return isDark
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
  const isDark = useIsDarkTheme()

  return (
    <MilkdownProvider>
      <div
        className={isDark ? 'milkdown-theme-dark' : 'milkdown-theme-light'}
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
