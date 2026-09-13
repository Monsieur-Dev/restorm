/**
 * The Response tab's body: an always-present Download button plus a viewer
 * picked from the Content-Type — an inline image, a playable video or audio
 * element, rendered markdown, a code editor for text, or a short notice for
 * a binary nothing here can show. No preview/raw toggle: the enriched view is
 * the view; Download hands the exact bytes to whatever tool the user prefers.
 *
 * Fed with the same `HTTPResponse` shape by the live request tab, the
 * response history and the recording capture pane, so all three render
 * identically.
 */

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { TFunction } from 'i18next'
import { Button, CodeEditor, MarkdownViewer } from 'electron-core-ui/renderer'
import type { HTTPResponse } from '../../../../shared/types/collections'
import { classifyResponseBody, downloadFileName, formatBytes, responseBodyBytes, responseBodyDataUrl, responseBodyText } from './responseBody'

const rootStyle: CSSProperties = { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 8, height: '100%', boxSizing: 'border-box' }
const toolbarStyle: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexShrink: 0 }
const summaryStyle: CSSProperties = { color: 'var(--descriptionForeground)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const editorContainerStyle: CSSProperties = { flex: 1, minHeight: 0, border: '1px solid var(--panel-border)', borderRadius: 3, boxSizing: 'border-box' }
const mediaBoxStyle: CSSProperties = { flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 8, border: '1px solid var(--panel-border)', borderRadius: 3, boxSizing: 'border-box' }
const markdownBoxStyle: CSSProperties = { flex: 1, minHeight: 0, overflow: 'auto', padding: '0 12px', border: '1px solid var(--panel-border)', borderRadius: 3, boxSizing: 'border-box' }
const noticeStyle: CSSProperties = { padding: 12, color: 'var(--descriptionForeground)' }

export interface ResponseBodyViewerProps {
  response: HTTPResponse
  t: TFunction
}

/** A playable media element over a blob URL of the body. Mounted with a
 * `key` per response so the URL is minted once per body (state initialiser)
 * and revoked when the element goes away. */
function MediaElement({ response, mime, kind }: { response: HTTPResponse; mime: string; kind: 'video' | 'audio' }): React.JSX.Element | null {
  const [url] = useState<string | null>(() => {
    try {
      return URL.createObjectURL(new Blob([responseBodyBytes(response)], { type: mime.length > 0 ? mime : 'application/octet-stream' }))
    } catch {
      return null
    }
  })
  useEffect(() => () => { if (url !== null) URL.revokeObjectURL(url) }, [url])
  if (url === null) return null
  return kind === 'video'
    ? <video controls src={url} style={{ maxWidth: '100%', maxHeight: '100%' }} data-testid="http-response-video" />
    : <audio controls src={url} style={{ width: '100%' }} data-testid="http-response-audio" />
}

/** The inline image, falling back to the binary notice when the bytes do
 * not decode as an image (keyed per response so the state resets). */
function ImageElement({ src, fallback }: { src: string; fallback: React.ReactNode }): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  if (failed) return <>{fallback}</>
  return (
    <div style={mediaBoxStyle}>
      <img src={src} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} data-testid="http-response-image" onError={() => { setFailed(true) }} />
    </div>
  )
}

export function ResponseBodyViewer({ response, t }: ResponseBodyViewerProps): React.JSX.Element {
  const { kind, mime, language } = useMemo(() => classifyResponseBody(response), [response])

  const text = useMemo(() => {
    if (kind !== 'text' && kind !== 'markdown') return ''
    const raw = responseBodyText(response)
    if (language !== 'json') return raw
    try {
      return JSON.stringify(JSON.parse(raw), null, 2)
    } catch {
      return raw
    }
  }, [response, kind, language])

  const download = (): void => {
    try {
      const blob = new Blob([responseBodyBytes(response)], { type: mime.length > 0 ? mime : 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = downloadFileName(mime)
      anchor.click()
      URL.revokeObjectURL(url)
    } catch {
      // A malformed payload simply produces no download.
    }
  }

  const summary = [mime.length > 0 ? mime : t('requestTab.responses.body.unknownType'), response.contentLength !== undefined ? formatBytes(response.contentLength) : null]
    .filter((part): part is string => part !== null)
    .join(' · ')

  const binaryNotice = (
    <div style={noticeStyle} data-testid="http-response-binary">
      {t('requestTab.responses.body.binary', { type: mime.length > 0 ? mime : t('requestTab.responses.body.unknownType') })}
    </div>
  )

  let body: React.ReactNode
  switch (kind) {
    case 'empty':
      body = <div style={noticeStyle} data-testid="http-response-empty">{t('requestTab.responses.noResponseBody')}</div>
      break
    case 'image':
      body = <ImageElement key={`${response.id}:${mime}`} src={responseBodyDataUrl(response, mime)} fallback={binaryNotice} />
      break
    case 'video':
      body = (
        <div style={mediaBoxStyle}>
          <MediaElement key={`${response.id}:${mime}`} response={response} mime={mime} kind="video" />
        </div>
      )
      break
    case 'audio':
      body = (
        <div style={mediaBoxStyle}>
          <MediaElement key={`${response.id}:${mime}`} response={response} mime={mime} kind="audio" />
        </div>
      )
      break
    case 'markdown':
      body = (
        <div style={markdownBoxStyle} data-testid="http-response-markdown">
          <MarkdownViewer value={text} />
        </div>
      )
      break
    case 'text':
      body = (
        <div style={editorContainerStyle}>
          <CodeEditor
            height="100%"
            language={language}
            value={text}
            options={{ minimap: { enabled: false }, wordWrap: 'on', scrollBeyondLastLine: false, automaticLayout: true, readOnly: true }}
            data-testid="http-response-body-editor"
          />
        </div>
      )
      break
    default:
      body = binaryNotice
  }

  return (
    <div style={rootStyle} data-testid="http-response-body">
      <div style={toolbarStyle}>
        <span style={summaryStyle} data-testid="http-response-body-summary">{summary}</span>
        <Button secondary icon="download" onClick={download} data-testid="http-response-download-button">
          {t('requestTab.responses.body.download')}
        </Button>
      </div>
      {body}
    </div>
  )
}
