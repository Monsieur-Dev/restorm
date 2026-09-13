// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import type { TFunction } from 'i18next'

// The ECUI renderer barrel side-loads Monaco / CSS that don't resolve under
// vitest: stub the three primitives the viewer uses, each exposing what it
// received so the test can assert on the decoded content.
vi.mock('electron-core-ui/renderer', () => ({
  Button: ({ children, icon, ...rest }: { children?: ReactNode; icon?: string; 'data-testid'?: string; onClick?: () => void }): ReactNode =>
    createElement('button', { 'data-testid': rest['data-testid'], 'data-icon': icon, onClick: rest.onClick }, children),
  CodeEditor: ({ value, language, ...rest }: { value: string; language: string; 'data-testid'?: string }): ReactNode =>
    createElement('pre', { 'data-testid': rest['data-testid'], 'data-language': language }, value),
  MarkdownViewer: ({ value }: { value: string }): ReactNode => createElement('div', { 'data-testid': 'markdown-stub' }, value)
}))

import { ResponseBodyViewer } from '../../src/renderer/src/components/RequestTabViews/ResponseBodyViewer'
import type { HTTPResponse } from '../../src/shared/types/collections'

const t = ((key: string, options?: Record<string, unknown>) => (typeof options?.['type'] === 'string' ? `${key}:${options['type']}` : key)) as unknown as TFunction

function response(overrides: Partial<HTTPResponse>): HTTPResponse {
  return {
    id: 'r1', type: 'http', requestId: 'req', requestUrl: 'http://x/', requestMethod: 'GET',
    requestHeaders: [], requestParams: [], requestPathParams: [],
    statusCode: 200, statusText: 'OK', responseHeaders: [], responseBody: '',
    timings: { startedAt: new Date().toISOString(), durationMs: 1 },
    ...overrides
  } as HTTPResponse
}

afterEach(() => { cleanup() })

describe('ResponseBodyViewer', () => {
  it('always offers the translated Download button with the download codicon', () => {
    for (const r of [
      response({ responseBody: '{"a":1}', contentType: 'application/json' }),
      response({ responseBody: 'AAEC', bodyIsBase64: true, contentType: 'image/png' }),
      response({ responseBody: 'AAEC', bodyIsBase64: true, contentType: 'application/pdf' }),
      response({ responseBody: '' })
    ]) {
      const { unmount } = render(<ResponseBodyViewer response={r} t={t} />)
      const button = screen.getByTestId('http-response-download-button')
      expect(button.textContent).toBe('requestTab.responses.body.download')
      expect(button.dataset['icon']).toBe('download')
      unmount()
    }
  })

  it('renders an image inline from its bytes', () => {
    render(<ResponseBodyViewer response={response({ responseBody: 'AAEC', bodyIsBase64: true, contentType: 'image/png', contentLength: 3 })} t={t} />)
    expect(screen.getByTestId('http-response-image').getAttribute('src')).toBe('data:image/png;base64,AAEC')
    expect(screen.getByTestId('http-response-body-summary').textContent).toBe('image/png · 3 B')
    expect(screen.queryByTestId('http-response-binary')).toBeNull()
  })

  it('falls back to the binary notice when the image bytes do not decode', () => {
    render(<ResponseBodyViewer response={response({ responseBody: 'AAEC', bodyIsBase64: true, contentType: 'image/png' })} t={t} />)
    fireEvent.error(screen.getByTestId('http-response-image'))
    expect(screen.queryByTestId('http-response-image')).toBeNull()
    expect(screen.getByTestId('http-response-binary').textContent).toBe('requestTab.responses.body.binary:image/png')
    expect(screen.getByTestId('http-response-download-button')).not.toBeNull()
  })

  it('renders markdown through the shared viewer, decoding a base64 capture body', () => {
    const md = Buffer.from('# Title', 'utf8').toString('base64')
    render(<ResponseBodyViewer response={response({ responseBody: md, bodyIsBase64: true, contentType: 'text/markdown' })} t={t} />)
    expect(screen.getByTestId('markdown-stub').textContent).toBe('# Title')
  })

  it('renders text in the code editor with the language of its Content-Type, pretty-printing JSON', () => {
    render(<ResponseBodyViewer response={response({ responseBody: '{"a":1}', contentType: 'application/json; charset=utf-8' })} t={t} />)
    const editor = screen.getByTestId('http-response-body-editor')
    expect(editor.dataset['language']).toBe('json')
    expect(editor.textContent).toBe('{\n  "a": 1\n}')
    cleanup()
    render(<ResponseBodyViewer response={response({ responseBody: '<r/>', contentType: 'text/xml' })} t={t} />)
    expect(screen.getByTestId('http-response-body-editor').dataset['language']).toBe('xml')
  })

  it('shows a notice for a binary nothing can preview, and the empty notice for no body', () => {
    render(<ResponseBodyViewer response={response({ responseBody: 'AAEC', bodyIsBase64: true, contentType: 'application/pdf' })} t={t} />)
    expect(screen.getByTestId('http-response-binary').textContent).toBe('requestTab.responses.body.binary:application/pdf')
    cleanup()
    render(<ResponseBodyViewer response={response({ responseBody: '' })} t={t} />)
    expect(screen.getByTestId('http-response-empty').textContent).toBe('requestTab.responses.noResponseBody')
  })
})
