import React, { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import mermaid from 'mermaid'

import './markdownViewer.css'

export interface MarkdownViewerProps {
  /** Markdown content to render (read-only) */
  value: string
  /** Enable Mermaid fenced code blocks ```mermaid */
  allowMermaid?: boolean
  /** Optional additional CSS class name */
  className?: string
  /** Optional inline styles */
  style?: React.CSSProperties
}

/**
 * Determine if the current theme is dark based on data-theme attribute
 */
function useIsDarkTheme(): boolean {
  const [isDark, setIsDark] = useState<boolean>(() => {
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

interface MermaidBlockProps {
  code: string
  isDark: boolean
}

const MermaidBlock: React.FC<MermaidBlockProps> = ({ code, isDark }) => {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const render = async (): Promise<void> => {
      try {
        // Initialize Mermaid with a theme matching the current VSCode-like theme.
        // We re-apply the config on each render to react to theme changes.
        mermaid.initialize({
          startOnLoad: false,
          theme: isDark ? 'dark' : 'default',
          securityLevel: 'loose'
        })

        const host = containerRef.current
        if (!host) return

        // Generate a unique ID for this diagram
        const id = `mermaid-${Math.random().toString(36).slice(2)}`

        // Render to SVG and inject into the container
        const { svg } = await mermaid.render(id, code)
        host.innerHTML = svg
      } catch {
        // Fallback: show raw Mermaid code if rendering fails
        if (containerRef.current) {
          containerRef.current.innerText = code
        }
      }
    }

    void render()
  }, [code, isDark])

  return <div ref={containerRef} className="markdown-viewer-mermaid" />
}

export const MarkdownViewer: React.FC<MarkdownViewerProps> = ({ value, allowMermaid = true, className, style }) => {
  const isDark = useIsDarkTheme()
  const rootClassName = [
    'markdown-viewer',
    isDark ? 'markdown-viewer-dark' : 'markdown-viewer-light',
    className
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={rootClassName} style={style}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Use a custom renderer for code blocks so we can support Mermaid
          code(codeProps: JSX.IntrinsicElements['code']) {
            const {
              inline,
              className: codeClassName,
              children,
              ...props
            } = codeProps as JSX.IntrinsicElements['code'] & { inline?: boolean }
            const match = /language-(\w+)/.exec(codeClassName ?? '')
            const codeContent = String(children).replace(/\n$/, '')

            if (!inline && match && match[1] === 'mermaid' && allowMermaid) {
              return <MermaidBlock code={codeContent} isDark={isDark} />
            }

            return (
              <code className={codeClassName} {...props}>
                {children}
              </code>
            )
          },
          // Custom link renderer: open HTTP(S) links directly in a new browser window/tab
          a(anchorProps: JSX.IntrinsicElements['a']) {
            const { href, children, ...rest } = anchorProps

            const handleClick = (event: React.MouseEvent<HTMLAnchorElement>): void => {
              if (!href) return

              const isHttpLink = href.startsWith('http://') || href.startsWith('https://')
              if (!isHttpLink) {
                return
              }

              event.preventDefault()
              event.stopPropagation()
              window.open(href, '_blank', 'noopener,noreferrer')
            }

            return (
              <a
                href={href}
                {...rest}
                onClick={handleClick}
              >
                {children}
              </a>
            )
          }
        }}
      >
        {value}
      </ReactMarkdown>
    </div>
  )
}

export default MarkdownViewer
