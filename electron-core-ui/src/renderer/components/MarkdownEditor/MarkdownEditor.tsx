import React, { useEffect, useState, useRef } from 'react'
import { MilkdownProvider, Milkdown, useEditor } from '@milkdown/react'
import { Crepe } from '@milkdown/crepe'
import type { ListenerManager } from '@milkdown/kit/plugin/listener'
import '@milkdown/crepe/theme/common/style.css'
import './markdown.css'

// Type for Crepe instance with on() method
interface CrepeWithListener {
  on: (fn: (api: ListenerManager) => void) => CrepeWithListener
}

export interface MarkdownEditorProps {
  /**
   * Initial markdown content to display in the editor.
   */
  initialValue?: string
  /**
   * Callback fired when the markdown content changes.
   */
  onChange?: (markdown: string) => void
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

interface MarkdownEditorInnerProps {
  initialValue: string
  onChange?: ((markdown: string) => void) | undefined
}

const MarkdownEditorInner: React.FC<MarkdownEditorInnerProps> = ({ initialValue, onChange }) => {
  // Use ref to avoid stale closure in listener callback
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEditor((root) => {
    const crepe = new Crepe({
      root,
      defaultValue: initialValue
    })

    // Add listener for change detection using Crepe's built-in API
    ;(crepe as unknown as CrepeWithListener).on((listener: ListenerManager) => {
      listener.markdownUpdated((_ctx, markdown: string) => {
        onChangeRef.current?.(markdown)
      })
    })

    return crepe
  }, [initialValue])

  return <Milkdown />
}

export const MarkdownEditor: React.FC<MarkdownEditorProps> = ({ initialValue, onChange }) => {
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
        <MarkdownEditorInner initialValue={initialValue ?? ''} onChange={onChange} />
      </div>
    </MilkdownProvider>
  )
}

export default MarkdownEditor
