import React, { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeHighlight from 'rehype-highlight'
import './markdownViewer.css'
// Theme-aware syntax highlighting: instead of a fixed highlight.js stylesheet
// (which hardcodes dark colors), the `.hljs-*` token classes are coloured from
// theme CSS variables so they track light / dark / high-contrast. See
// highlightTheme.css + the `--hljs-*` vars defined per theme family.
import './highlightTheme.css'

type MermaidAPI = typeof import('mermaid').default
let mermaidInstance: MermaidAPI | undefined

async function getMermaid(): Promise<MermaidAPI> {
  if (!mermaidInstance) {
    const mod = await import('mermaid')
    mermaidInstance = mod.default
  }
  return mermaidInstance
}

interface CodeBlockProps {
  children: React.ReactNode
  copyText: string
  dataTestId?: string
}

const CodeBlock: React.FC<CodeBlockProps> = ({ children, copyText, dataTestId }) => {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  // Track the copy-reset timer so it can be cleared on unmount (or before a
  // re-arm) — an untracked setTimeout fired setCopied() after unmount when the
  // block was removed within the 2s window.
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (resetTimerRef.current) clearTimeout(resetTimerRef.current) }, [])

  const handleCopy = useCallback(() => {
    const copyToClipboard = async (): Promise<void> => {
      try {
        await navigator.clipboard.writeText(copyText)
      } catch {
        // Clipboard can be unavailable/blocked in some environments (e.g., tests).
        // We still update UI state to reflect the user intent.
      }
      setCopied(true)
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
      resetTimerRef.current = setTimeout(() => { setCopied(false) }, 2000)
    }
    void copyToClipboard()
  }, [copyText])

  return (
    <div className="markdown-code-block" {...(dataTestId && { 'data-testid': dataTestId })}>
      {/* Inner wrapper hugs the <pre> exactly so the absolutely-
        * positioned copy button anchors to the code frame's own
        * edges — not the outer block's padding box. The outer block
        * can pick up horizontal padding from contexts like a
        * <details> disclosure (`details > :not(summary)`), which
        * would otherwise leave the button hanging past the frame. */}
      <div className="markdown-code-block-inner">
        <button
          type="button"
          className={`markdown-code-copy-btn ${copied ? 'copied' : ''}`}
          onClick={handleCopy}
          aria-label={copied ? t('codeEditor.copyButton.copied', 'Copied!') : t('codeEditor.copyButton.copy', 'Copy code')}
          {...(dataTestId && {
            'data-testid': `${dataTestId}-copy`,
            'data-is-copied': copied ? 'true' : 'false'
          })}
        >
          <i className={`codicon codicon-${copied ? 'check' : 'copy'}`} />
        </button>
        <pre>{children}</pre>
      </div>
    </div>
  )
}

export interface MarkdownViewerProps {
  /** Markdown content to render (read-only) */
  value: string
  /** Enable Mermaid fenced code blocks ```mermaid */
  allowMermaid?: boolean
  /** Tighten margins/padding — for rendering a small snippet (e.g. a single
   * code block) inline, without the document-style block spacing. */
  compact?: boolean
  /** Optional test id applied to the MarkdownViewer root element. */
  'data-testid'?: string
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
  dataTestId?: string
}

const MermaidBlock: React.FC<MermaidBlockProps> = ({ code, isDark, dataTestId }) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [isRendered, setIsRendered] = useState(false)

  useEffect(() => {
    if (!containerRef.current) return

    const render = async (): Promise<void> => {
      try {
        setIsRendered(false)
        // Lazy-load mermaid only when a diagram is actually rendered.
        const mermaid = await getMermaid()

        // Initialize Mermaid with a theme matching the current theme.
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
        setIsRendered(true)
      } catch {
        // Fallback: show raw Mermaid code if rendering fails
        if (containerRef.current) {
          containerRef.current.innerText = code
        }
        setIsRendered(false)
      }
    }

    void render()
  }, [code, isDark])

  return (
    <div
      ref={containerRef}
      className="markdown-viewer-mermaid"
      {...(dataTestId && {
        'data-testid': dataTestId,
        'data-is-rendered': isRendered ? 'true' : 'false'
      })}
    />
  )
}

function extractText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (React.isValidElement(node)) {
    const props = node.props as { children?: React.ReactNode }
    return extractText(props.children)
  }
  return ''
}

function normalizeCodeText(value: string): string {
  return value.replace(/\n$/, '')
}

function parseMarkdownViewerValue(markdown: string): { codeBlocks: string[]; mermaidBlocks: string[]; httpLinks: string[] } {
  const codeBlocks: string[] = []
  const mermaidBlocks: string[] = []
  const httpLinks: string[] = []

  const fenceRe = /```([a-zA-Z0-9_-]+)?\n([\s\S]*?)\n```/g
  for (;;) {
    const match = fenceRe.exec(markdown)
    if (!match) break
    const lang = (match[1] ?? '').trim()
    const code = normalizeCodeText(match[2] ?? '')
    codeBlocks.push(code)
    if (lang === 'mermaid') {
      mermaidBlocks.push(code)
    }
  }

  const linkRe = /\[[^\]]+\]\((https?:\/\/[^)]+)\)/g
  for (;;) {
    const match = linkRe.exec(markdown)
    if (!match) break
    const href = match[1] ?? ''
    if (href) {
      httpLinks.push(href)
    }
  }

  return { codeBlocks, mermaidBlocks, httpLinks }
}

export const MarkdownViewer: React.FC<MarkdownViewerProps> = ({ value, allowMermaid = true, compact = false, className, style, 'data-testid': dataTestId }) => {
  const isDark = useIsDarkTheme()
  const parsed = React.useMemo(() => parseMarkdownViewerValue(value), [value])
  const rootClassName = [
    'markdown-viewer',
    isDark ? 'markdown-viewer-dark' : 'markdown-viewer-light',
    compact ? 'markdown-viewer--compact' : '',
    className
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={rootClassName}
      style={style}
      {...(dataTestId && {
        'data-testid': dataTestId,
        'data-allow-mermaid': allowMermaid ? 'true' : 'false',
        'data-is-dark': isDark ? 'true' : 'false'
      })}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeHighlight]}
        components={{
          // Custom renderer for pre blocks to add copy button
          pre(preProps: React.JSX.IntrinsicElements['pre']) {
            const { children } = preProps
            // Check if this is a mermaid block
            const codeChild = React.Children.toArray(children)[0]
            if (React.isValidElement(codeChild)) {
              const codeClassName = (codeChild.props as { className?: string }).className ?? ''
              const match = /language-(\w+)/.exec(codeClassName)
              if (match?.[1] === 'mermaid' && allowMermaid) {
                const rawChildren = (codeChild.props as { children?: React.ReactNode }).children
                const codeContent = normalizeCodeText(typeof rawChildren === 'string' ? rawChildren : '')
                const idx = Math.max(0, parsed.mermaidBlocks.indexOf(codeContent))
                return (
                  <MermaidBlock
                    code={codeContent}
                    isDark={isDark}
                    {...(dataTestId && { dataTestId: `${dataTestId}-mermaid-${idx}` })}
                  />
                )
              }
            }
            const copyText = normalizeCodeText(extractText(codeChild))
            const idx = Math.max(0, parsed.codeBlocks.indexOf(copyText))
            return (
              <CodeBlock copyText={copyText} {...(dataTestId && { dataTestId: `${dataTestId}-codeblock-${idx}` })}>
                {children}
              </CodeBlock>
            )
          },
          // Use a custom renderer for inline code
          code(codeProps: JSX.IntrinsicElements['code']) {
            const {
              className: codeClassName,
              children,
              ...props
            } = codeProps
            return (
              <code className={codeClassName} {...props}>
                {children}
              </code>
            )
          },
          // Custom link renderer: open HTTP(S) links directly in a new browser window/tab
          a(anchorProps: React.JSX.IntrinsicElements['a']) {
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

            const isHttpLink = (href ?? '').startsWith('http://') || (href ?? '').startsWith('https://')
            const idx = isHttpLink ? Math.max(0, parsed.httpLinks.indexOf(href ?? '')) : -1

            return (
              <a
                href={href}
                {...rest}
                onClick={handleClick}
                {...(dataTestId && isHttpLink && { 'data-testid': `${dataTestId}-link-${idx}` })}
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
