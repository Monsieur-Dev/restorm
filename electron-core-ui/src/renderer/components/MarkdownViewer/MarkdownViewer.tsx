import React, { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown, { defaultUrlTransform, type UrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeHighlight from 'rehype-highlight'
import { Button } from '../Button'
import { Tooltip } from '../Tooltip'
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
  const [showCopyTooltip, setShowCopyTooltip] = useState(false)
  const copyBtnRef = useRef<HTMLSpanElement>(null)
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
        <span
          ref={copyBtnRef}
          style={{ display: 'inline-flex' }}
          {...(dataTestId && { 'data-is-copied': copied ? 'true' : 'false' })}
        >
          <Button
            line
            icon={copied ? 'check' : 'copy'}
            className={`markdown-code-copy-btn ${copied ? 'copied' : ''}`}
            options={{ ariaLabel: copied ? t('codeEditor.copyButton.copied', 'Copied!') : t('codeEditor.copyButton.copy', 'Copy code') }}
            onClick={handleCopy}
            onMouseEnter={() => { setShowCopyTooltip(true) }}
            onMouseLeave={() => { setShowCopyTooltip(false) }}
            {...(dataTestId && { 'data-testid': `${dataTestId}-copy` })}
          />
        </span>
        <Tooltip
          targetRef={copyBtnRef}
          content={copied ? t('codeEditor.copyButton.copied', 'Copied!') : t('codeEditor.copyButton.copy', 'Copy code')}
          show={showCopyTooltip}
          placement="below"
        />
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
  /**
   * Render ONLY self-contained inline `data:` images — any image the renderer
   * would have to fetch over the network (`![](https://…)`, a reference-style
   * image, a `<picture><source srcset>`) is dropped instead of displayed.
   *
   * For contexts whose outbound traffic is firewalled or simply unavailable, so
   * a remote image would hang, prompt, or leak a request rather than render.
   * Off by default — normal documents keep loading their images.
   */
  inlineImagesOnly?: boolean
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

/** Raster image types allowed as an inline `data:` URI. Deliberately excludes
 * `image/svg+xml`: an SVG is a document, and while an `<img>` renders it in a
 * non-scripted context, keeping it off the list means no future widening of the
 * attribute check can turn it into a script vector. The trailing `[;,]` matches
 * both data-URI forms — `;base64,…` and a bare `,…` percent-encoded payload —
 * while still requiring the media type to END there, so a longer type that
 * merely starts with an allowed one cannot slip through. */
const INLINE_IMAGE_DATA_URI = /^data:image\/(?:png|jpeg|jpg|gif|webp|avif|bmp)[;,]/i

/** Render nothing — used by `inlineImagesOnly` to remove resource-loading tags. */
function dropNode(): null {
  return null
}

/**
 * Allow inline `data:image/…` URIs **on `<img src>` only** (react-markdown's
 * default transform strips every `data:` URL for safety). Self-contained images
 * render without any network fetch — the only image kind an outbound-firewalled
 * context can safely display.
 *
 * The element/attribute check is load-bearing, not defensive tidiness:
 * `urlTransform` runs for every URL attribute react-markdown knows about
 * (`object[data]`, `embed[src]`, `iframe[src]`, `source[src]`, `video[poster]`,
 * …). A `data:` URL on `object`/`embed`/`iframe` loads as a *document* — and
 * since this viewer runs `rehypeRaw` (raw HTML passes through) with no
 * sanitiser, permitting one there would let authored markdown execute script.
 * Everything that is not an `<img src>` keeps the default transform.
 */
const markdownUrlTransform: UrlTransform = (url, key, node) => {
  if (node.tagName === 'img' && key === 'src' && INLINE_IMAGE_DATA_URI.test(url)) return url
  return defaultUrlTransform(url)
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

export const MarkdownViewer: React.FC<MarkdownViewerProps> = ({ value, allowMermaid = true, compact = false, inlineImagesOnly = false, className, style, 'data-testid': dataTestId }) => {
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
        urlTransform={markdownUrlTransform}
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
          },
          // `inlineImagesOnly`: drop every element that would make the renderer
          // FETCH something, keeping only self-contained inline `data:` images.
          //
          // Enforced here rather than by scrubbing the markdown text, because by
          // this point the tree is fully resolved — reference-style images
          // (`![alt][ref]` + a `[ref]: https://…` definition elsewhere in the
          // document) have become plain `img` nodes, and a regex over the source
          // text does not see them. Returning null means React never creates the
          // element, so no request is issued.
          //
          // The non-`img` tags below are dropped wholesale: `rehypeRaw` lets raw
          // HTML through, and each of these loads a remote resource by itself.
          // They carry no meaning this viewer's callers need, so removing them
          // costs nothing and keeps the "renders nothing fetchable" guarantee
          // true rather than approximately true.
          ...(inlineImagesOnly && {
            img(imgProps: React.JSX.IntrinsicElements['img']) {
              const { src } = imgProps
              if (typeof src !== 'string' || !INLINE_IMAGE_DATA_URI.test(src)) return null
              // Two attributes survive `src` being safe and would still fetch:
              // `srcSet` (which the browser PREFERS over `src`, and which
              // `urlTransform` never sees — it is absent from react-markdown's
              // URL-attribute map) and `style` (`background-image: url(…)`).
              const { style: _style, srcSet: _srcSet, ...rest } = imgProps
              return <img {...rest} />
            },
            // `<input type="image" src>` fetches like an image. Only that type
            // is dropped — plain inputs are GFM task-list checkboxes.
            input(inputProps: React.JSX.IntrinsicElements['input']) {
              if (inputProps.type === 'image') return null
              return <input {...inputProps} />
            },
            source: dropNode,
            video: dropNode,
            audio: dropNode,
            iframe: dropNode,
            embed: dropNode,
            object: dropNode,
            track: dropNode
          })
        }}
      >
        {value}
      </ReactMarkdown>
    </div>
  )
}

export default MarkdownViewer
