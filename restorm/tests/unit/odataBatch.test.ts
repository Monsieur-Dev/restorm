import { describe, it, expect } from 'vitest'
import {
  serializeODataBatch,
  parseODataBatchResponse,
  extractBoundary
} from '../../src/shared/utils/odataBatch'

describe('serializeODataBatch', () => {
  it('uses the caller-provided boundary and wraps each part with it', () => {
    const out = serializeODataBatch(
      [
        { method: 'GET', url: 'Pets(1)' },
        { method: 'GET', url: 'Pets(2)' }
      ],
      'batch_test'
    )
    expect(out.boundary).toBe('batch_test')
    expect(out.contentType).toBe('multipart/mixed; boundary=batch_test')
    expect(out.body).toContain('--batch_test\r\n')
    expect(out.body).toContain('GET Pets(1) HTTP/1.1')
    expect(out.body).toContain('GET Pets(2) HTTP/1.1')
    expect(out.body.trimEnd().endsWith('--batch_test--')).toBe(true)
  })

  it('emits application/http envelope headers on every part', () => {
    const out = serializeODataBatch([{ method: 'GET', url: 'Pets' }], 'b')
    expect(out.body).toContain('Content-Type: application/http')
    expect(out.body).toContain('Content-Transfer-Encoding: binary')
  })

  it('defaults Content-Type to application/json on bodied non-GET requests', () => {
    const out = serializeODataBatch(
      [{ method: 'POST', url: 'Pets', body: '{"Name":"Rex"}' }],
      'b'
    )
    expect(out.body).toContain('Content-Type: application/json')
    expect(out.body).toContain('{"Name":"Rex"}')
  })

  it('preserves caller-supplied Content-Type case-insensitively (no duplicate)', () => {
    const out = serializeODataBatch(
      [{ method: 'POST', url: 'Pets', body: '<xml/>', headers: { 'content-type': 'application/xml' } }],
      'b'
    )
    // Only one Content-Type line (the caller-supplied one).
    const ctCount = (out.body.match(/content-type: application\/xml/gi) ?? []).length
    expect(ctCount).toBe(1)
    expect(out.body).not.toContain('Content-Type: application/json')
  })

  it('generates a unique boundary when none is provided', () => {
    const a = serializeODataBatch([{ method: 'GET', url: 'Pets' }])
    const b = serializeODataBatch([{ method: 'GET', url: 'Pets' }])
    expect(a.boundary).toMatch(/^batch_/)
    expect(b.boundary).toMatch(/^batch_/)
    expect(a.boundary).not.toBe(b.boundary)
  })

  it('returns a body with only the terminator when given no sub-requests', () => {
    const out = serializeODataBatch([], 'b')
    expect(out.body).toContain('--b--')
    expect(out.body).not.toMatch(/HTTP\/1\.1/)
  })
})

describe('parseODataBatchResponse', () => {
  const multipart = [
    '--resp_1',
    'Content-Type: application/http',
    'Content-Transfer-Encoding: binary',
    '',
    'HTTP/1.1 200 OK',
    'Content-Type: application/json',
    'OData-Version: 4.0',
    '',
    '{"Id":1,"Name":"Rex"}',
    '--resp_1',
    'Content-Type: application/http',
    'Content-Transfer-Encoding: binary',
    '',
    'HTTP/1.1 404 Not Found',
    '',
    '',
    '--resp_1--',
    ''
  ].join('\r\n')

  it('returns one entry per sub-response with status + headers + body', () => {
    const out = parseODataBatchResponse(multipart, 'resp_1')
    expect(out).toHaveLength(2)
    expect(out[0]?.status).toBe(200)
    expect(out[0]?.statusText).toBe('OK')
    expect(out[0]?.headers['content-type']).toBe('application/json')
    expect(out[0]?.headers['odata-version']).toBe('4.0')
    expect(out[0]?.body).toBe('{"Id":1,"Name":"Rex"}')
    expect(out[1]?.status).toBe(404)
    expect(out[1]?.statusText).toBe('Not Found')
    expect(out[1]?.body).toBe('')
  })

  it('returns [] for an empty body or missing boundary', () => {
    expect(parseODataBatchResponse('', 'resp_1')).toEqual([])
    expect(parseODataBatchResponse(multipart, '')).toEqual([])
  })

  it('ignores preamble / epilogue chunks', () => {
    const withPreamble = 'preamble text\r\n' + multipart
    const out = parseODataBatchResponse(withPreamble, 'resp_1')
    expect(out).toHaveLength(2)
  })

  it('emits status 0 when the HTTP status line is malformed', () => {
    const bad = [
      '--b',
      'Content-Type: application/http',
      '',
      'not-a-status-line',
      'X-Header: value',
      '',
      '',
      '--b--',
      ''
    ].join('\r\n')
    const out = parseODataBatchResponse(bad, 'b')
    expect(out).toHaveLength(1)
    expect(out[0]?.status).toBe(0)
    // Malformed line falls under "no colon → skip", so X-Header still
    // lands in the result.
    expect(out[0]?.headers['x-header']).toBe('value')
  })
})

describe('extractBoundary', () => {
  it('handles unquoted tokens', () => {
    expect(extractBoundary('multipart/mixed; boundary=batch_1234')).toBe('batch_1234')
  })

  it('handles quoted tokens with embedded punctuation', () => {
    expect(extractBoundary('multipart/mixed; boundary="batch; 1234"')).toBe('batch; 1234')
  })

  it('returns null when missing', () => {
    expect(extractBoundary(undefined)).toBeNull()
    expect(extractBoundary('application/json')).toBeNull()
  })
})
