import { describe, it, expect } from 'vitest'
import { classifyResponseBody, downloadFileName, mediaTypeOf, responseBodyDataUrl, responseBodyText } from '../../src/renderer/src/components/RequestTabViews/responseBody'

const b64 = (text: string): string => Buffer.from(text, 'utf8').toString('base64')

describe('classifyResponseBody', () => {
  it('reads the media type without its parameters', () => {
    expect(mediaTypeOf('Text/HTML; charset=utf-8')).toBe('text/html')
    expect(mediaTypeOf(undefined)).toBe('')
  })

  it('picks the viewer from the Content-Type', () => {
    expect(classifyResponseBody({ responseBody: 'AAEC', bodyIsBase64: true, contentType: 'image/png' }).kind).toBe('image')
    expect(classifyResponseBody({ responseBody: 'AAEC', bodyIsBase64: true, contentType: 'video/mp4' }).kind).toBe('video')
    expect(classifyResponseBody({ responseBody: 'AAEC', bodyIsBase64: true, contentType: 'audio/mpeg' }).kind).toBe('audio')
    expect(classifyResponseBody({ responseBody: '# Hi', contentType: 'text/markdown; charset=utf-8' }).kind).toBe('markdown')
    expect(classifyResponseBody({ responseBody: '{}', contentType: 'application/json' })).toMatchObject({ kind: 'text', language: 'json' })
    expect(classifyResponseBody({ responseBody: '<a/>', contentType: 'application/xml' })).toMatchObject({ kind: 'text', language: 'xml' })
    expect(classifyResponseBody({ responseBody: 'a,b', contentType: 'text/csv' })).toMatchObject({ kind: 'text', language: 'plaintext' })
  })

  it('treats an unknown binary type as binary, an untyped text body as text, and nothing as empty', () => {
    expect(classifyResponseBody({ responseBody: 'AAEC', bodyIsBase64: true, contentType: 'application/pdf' }).kind).toBe('binary')
    expect(classifyResponseBody({ responseBody: 'AAEC', bodyIsBase64: true }).kind).toBe('binary')
    expect(classifyResponseBody({ responseBody: 'hello' }).kind).toBe('text')
    expect(classifyResponseBody({ responseBody: '', contentType: 'image/png' }).kind).toBe('empty')
  })

  it('a text body that arrived base64 (a recording capture) is still text', () => {
    const response = { responseBody: b64('{"ok":true}'), bodyIsBase64: true, contentType: 'application/json' }
    expect(classifyResponseBody(response).kind).toBe('text')
    expect(responseBodyText(response)).toBe('{"ok":true}')
  })
})

describe('responseBodyDataUrl', () => {
  it('inlines base64 bytes and utf-8 text (svg) alike', () => {
    expect(responseBodyDataUrl({ responseBody: 'AAEC', bodyIsBase64: true }, 'image/png')).toBe('data:image/png;base64,AAEC')
    expect(responseBodyDataUrl({ responseBody: '<svg/>' }, 'image/svg+xml')).toBe('data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E')
  })
})

describe('downloadFileName', () => {
  it('maps known media types to their usual extension', () => {
    expect(downloadFileName('image/jpeg')).toBe('response.jpg')
    expect(downloadFileName('audio/mpeg')).toBe('response.mp3')
    expect(downloadFileName('text/markdown')).toBe('response.md')
    expect(downloadFileName('application/octet-stream')).toBe('response.bin')
  })

  it('falls back to the sanitised subtype, then to .bin', () => {
    expect(downloadFileName('application/x-tar')).toBe('response.tar')
    expect(downloadFileName('application/vnd.api+json')).toBe('response.vndapi')
    expect(downloadFileName('')).toBe('response.bin')
  })
})
