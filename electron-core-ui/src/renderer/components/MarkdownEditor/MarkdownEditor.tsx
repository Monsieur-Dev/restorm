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
  /** Optional test id applied to the MarkdownEditor root element. */
  'data-testid'?: string
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
  dataTestId?: string
}

const MarkdownEditorInner: React.FC<MarkdownEditorInnerProps> = ({ initialValue, onChange, dataTestId }) => {
  // Use refs to avoid stale closures and track mounted state
  const onChangeRef = useRef(onChange)
  const isMountedRef = useRef(true)
  // Store initial value in ref to use only once at mount (avoid recreating editor on each change)
  const initialValueRef = useRef(initialValue)
  
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  // Track mounted state to prevent updates after unmount
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEditor((root) => {
    const crepe = new Crepe({
      root,
      defaultValue: initialValueRef.current
    })

    // Add listener for change detection using Crepe's built-in API
    ;(crepe as unknown as CrepeWithListener).on((listener: ListenerManager) => {
      listener.markdownUpdated((_ctx, markdown: string) => {
        // Only call onChange if component is still mounted
        if (isMountedRef.current) {
          onChangeRef.current?.(markdown)
        }
      })
    })

    return crepe
  }, []) // Empty deps - editor is created once at mount

  return (
    <div className="milkdown-editor-root" {...(dataTestId && { 'data-testid': `${dataTestId}-root` })}>
      <Milkdown />
    </div>
  )
}

export const MarkdownEditor: React.FC<MarkdownEditorProps> = ({ initialValue, onChange, 'data-testid': dataTestId }) => {
  const isDark = useIsDarkTheme()
  const initialText = initialValue ?? ''
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!dataTestId) return
    const wrapper = wrapperRef.current
    if (!wrapper) return

    const tryAttach = (): boolean => {
      const editor = wrapper.querySelector<HTMLElement>('.milkdown .editor')
      if (!editor) return false
      editor.setAttribute('data-testid', `${dataTestId}-editor`)
      return true
    }

    if (tryAttach()) return

    const observer = new MutationObserver(() => {
      if (tryAttach()) {
        observer.disconnect()
      }
    })
    observer.observe(wrapper, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
    }
  }, [dataTestId])

  return (
    <MilkdownProvider>
      <div
        ref={wrapperRef}
        className={isDark ? 'milkdown-theme-dark' : 'milkdown-theme-light'}
        style={{
          width: '100%',
          height: '100%',
          minHeight: 0,
          boxSizing: 'border-box',
        }}
        {...(dataTestId && {
          'data-testid': dataTestId,
          'data-is-dark': isDark ? 'true' : 'false',
          'data-initial-length': String(initialText.length)
        })}
      >
        <MarkdownEditorInner initialValue={initialText} onChange={onChange} {...(dataTestId && { dataTestId })} />
      </div>
    </MilkdownProvider>
  )
}

export default MarkdownEditor
