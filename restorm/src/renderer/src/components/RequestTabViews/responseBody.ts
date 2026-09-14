/**
 * Pure helpers behind the response body viewer: what kind of content a
 * response carries (decided from its Content-Type, never by sniffing the
 * bytes), how to read it as text, and how to name a downloaded file.
 * Shared by the request tabs, the response history and the recording
 * capture pane, which all feed the same `HTTPResponse` shape.
 */

export type ResponseBodyKind = 'empty' | 'image' | 'video' | 'audio' | 'markdown' | 'text' | 'binary'

export interface ResponseBodyClassification {
  kind: ResponseBodyKind
  /** Lower-cased media type without parameters (`image/png`), `''` when unknown. */
  mime: string
  /** Monaco language for the `text` kind. */
  language: string
}

interface ClassifiableResponse {
  responseBody: string
  bodyIsBase64?: boolean | undefined
  contentType?: string | undefined
}

const TEXT_MIME_MARKERS = ['json', 'xml', 'javascript', 'ecmascript', 'css', 'csv', 'yaml', 'x-www-form-urlencoded', 'x-ndjson', 'html']

export function mediaTypeOf(contentType: string | undefined): string {
  return (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
}

export function isTextMediaType(mime: string): boolean {
  return mime.startsWith('text/') || TEXT_MIME_MARKERS.some((marker) => mime.includes(marker))
}

export function editorLanguageOf(mime: string): string {
  if (mime.includes('json')) return 'json'
  if (mime.includes('html')) return 'html'
  if (mime.includes('xml')) return 'xml'
  if (mime.includes('javascript') || mime.includes('ecmascript')) return 'javascript'
  if (mime.includes('css')) return 'css'
  if (mime.includes('yaml')) return 'yaml'
  return 'plaintext'
}

/** Decide how a response body is shown. Text-like bodies win over "binary"
 * even when they arrive base64-encoded (a recording capture may carry any
 * body as base64) — they are decoded before display. */
export function classifyResponseBody(response: ClassifiableResponse): ResponseBodyClassification {
  const mime = mediaTypeOf(response.contentType)
  const language = editorLanguageOf(mime)
  if (response.responseBody.length === 0) return { kind: 'empty', mime, language }
  if (mime.startsWith('image/')) return { kind: 'image', mime, language }
  if (mime.startsWith('video/')) return { kind: 'video', mime, language }
  if (mime.startsWith('audio/')) return { kind: 'audio', mime, language }
  if (mime === 'text/markdown' || mime === 'text/x-markdown') return { kind: 'markdown', mime, language }
  if (isTextMediaType(mime)) return { kind: 'text', mime, language }
  if (response.bodyIsBase64 === true) return { kind: 'binary', mime, language }
  return { kind: 'text', mime, language }
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const chars = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(chars.length))
  for (let i = 0; i < chars.length; i += 1) bytes[i] = chars.charCodeAt(i)
  return bytes
}

/** UTF-8 bytes of a string, over a plain ArrayBuffer (a `BlobPart`). */
function utf8Bytes(text: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(text)
  const bytes = new Uint8Array(new ArrayBuffer(encoded.byteLength))
  bytes.set(encoded)
  return bytes
}

/** The body as text: decoded from base64 when flagged (UTF-8), else as is. */
export function responseBodyText(response: ClassifiableResponse): string {
  if (response.bodyIsBase64 !== true) return response.responseBody
  try {
    return new TextDecoder('utf-8').decode(base64ToBytes(response.responseBody))
  } catch {
    return response.responseBody
  }
}

/** The body as raw bytes, whatever its encoding. */
export function responseBodyBytes(response: ClassifiableResponse): Uint8Array<ArrayBuffer> {
  if (response.bodyIsBase64 === true) {
    try {
      return base64ToBytes(response.responseBody)
    } catch {
      return utf8Bytes(response.responseBody)
    }
  }
  return utf8Bytes(response.responseBody)
}

/** A `data:` URL for an inline `<img>` — base64 bytes or utf-8 text (svg). */
export function responseBodyDataUrl(response: ClassifiableResponse, mime: string): string {
  const type = mime.length > 0 ? mime : 'application/octet-stream'
  if (response.bodyIsBase64 === true) return `data:${type};base64,${response.responseBody}`
  return `data:${type};charset=utf-8,${encodeURIComponent(response.responseBody)}`
}

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/x-icon': 'ico',
  'image/avif': 'avif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/ogg': 'ogv',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'weba',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/gzip': 'gz',
  'application/json': 'json',
  'application/xml': 'xml',
  'text/xml': 'xml',
  'text/html': 'html',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'text/markdown': 'md',
  'text/x-markdown': 'md',
  'text/css': 'css',
  'text/javascript': 'js',
  'application/javascript': 'js',
  'application/x-yaml': 'yaml',
  'application/octet-stream': 'bin'
}

/** `response.<ext>` from the media type; unknown types fall back to the
 * sanitised subtype, and no type at all to `.bin`. */
export function downloadFileName(mime: string): string {
  const known = EXTENSIONS[mime]
  if (known !== undefined) return `response.${known}`
  const subtype = mime.split('/')[1] ?? ''
  const sanitized = subtype.replace(/^x-/, '').replace(/\+.*$/, '').replace(/[^a-z0-9]/g, '')
  return `response.${sanitized.length > 0 ? sanitized : 'bin'}`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
