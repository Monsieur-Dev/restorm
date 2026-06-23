import { describe, it, expect } from 'vitest'
import {
  serializeODataBatch,
  parseODataBatchResponse,
  serializeODataJsonBatch,
  parseODataJsonBatchResponse,
  extractBoundary,
  toRelativeBatchUrl
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

  it('wraps consecutive sub-requests with the same atomicityGroup in a nested changeset', () => {
    const out = serializeODataBatch(
      [
        { method: 'POST', url: 'Pets', body: '{"Name":"A"}', atomicityGroup: 'g1' },
        { method: 'POST', url: 'Pets', body: '{"Name":"B"}', atomicityGroup: 'g1' },
        { method: 'GET', url: 'Pets(1)' }
      ],
      'batch_t'
    )
    // Nested changeset header appears on the outer batch boundary.
    expect(out.body).toMatch(/--batch_t\r\nContent-Type: multipart\/mixed; boundary=changeset_[^\r\n]+/)
    // Inner changeset wraps the two POSTs, and its terminator `--changeset_…--` is present.
    expect(out.body).toMatch(/--changeset_[^\r\n]+--/)
    // The standalone GET is outside the changeset.
    expect(out.body).toContain('GET Pets(1) HTTP/1.1')
  })

  it('opens separate changesets when same-label sub-requests are non-consecutive', () => {
    const out = serializeODataBatch(
      [
        { method: 'POST', url: 'A', atomicityGroup: 'g' },
        { method: 'GET', url: 'B' },
        { method: 'POST', url: 'C', atomicityGroup: 'g' }
      ],
      'b'
    )
    const changesetCount = (out.body.match(/boundary=changeset_/g) ?? []).length
    expect(changesetCount).toBe(2)
  })

  it('includes GET in a change-set and emits a warning when allowGetInChangeSet is false (default)', () => {
    const out = serializeODataBatch(
      [
        { method: 'GET', url: 'Pets(1)', atomicityGroup: 'cs1' },
        { method: 'POST', url: 'Pets', body: '{"Name":"Rex"}', atomicityGroup: 'cs1' }
      ],
      'b'
    )
    // GET is still serialized inside the change-set (keep-in + warn).
    expect(out.body).toContain('GET Pets(1) HTTP/1.1')
    expect(out.body).toMatch(/Content-Type: multipart\/mixed; boundary=changeset_/)
    // A warning is emitted.
    expect(out.warnings).toHaveLength(1)
    expect(out.warnings[0]).toContain('GET "Pets(1)"')
    expect(out.warnings[0]).toContain('cs1')
  })

  it('emits no warning when allowGetInChangeSet is true', () => {
    const out = serializeODataBatch(
      [{ method: 'GET', url: 'Pets(1)', atomicityGroup: 'cs1' }],
      'b',
      { allowGetInChangeSet: true }
    )
    expect(out.body).toContain('GET Pets(1) HTTP/1.1')
    expect(out.warnings).toHaveLength(0)
  })

  it('emits no warning when the child has forceIncludeInChangeSet set', () => {
    const out = serializeODataBatch(
      [{ method: 'GET', url: 'Pets(1)', atomicityGroup: 'cs1', forceIncludeInChangeSet: true }],
      'b'
    )
    expect(out.body).toContain('GET Pets(1) HTTP/1.1')
    expect(out.warnings).toHaveLength(0)
  })

  it('emits warnings=[] on a request with no change-set GETs', () => {
    const out = serializeODataBatch(
      [
        { method: 'GET', url: 'Pets(1)' },
        { method: 'POST', url: 'Pets', body: '{"Name":"A"}', atomicityGroup: 'cs1' }
      ],
      'b'
    )
    expect(out.warnings).toHaveLength(0)
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

  it('parses a 4xx sub-response from a change-set rejection correctly', () => {
    // A server may wrap change-set rejections in a nested multipart/mixed.
    // Our parser keys on the outer boundary and returns all flat parts
    // (the nested changeset response is treated as a single opaque part).
    // This test verifies that a 400 part inside the outer envelope is
    // surfaced as a sub-response with status 400.
    const multipartWithError = [
      '--resp_outer',
      'Content-Type: application/http',
      'Content-Transfer-Encoding: binary',
      '',
      'HTTP/1.1 400 Bad Request',
      'Content-Type: application/json',
      '',
      '{"error":{"code":"BadRequest","message":"GET is not allowed in a change-set"}}',
      '--resp_outer--',
      ''
    ].join('\r\n')
    const out = parseODataBatchResponse(multipartWithError, 'resp_outer')
    expect(out).toHaveLength(1)
    expect(out[0]?.status).toBe(400)
    expect(out[0]?.statusText).toBe('Bad Request')
    expect(out[0]?.body).toContain('GET is not allowed in a change-set')
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

describe('serializeODataJsonBatch', () => {
  it('emits an application/json body with one request entry per sub-request', () => {
    const out = serializeODataJsonBatch([
      { method: 'GET', url: 'Products(1)' },
      { method: 'GET', url: 'Products(2)' }
    ])
    expect(out.contentType).toBe('application/json')
    const doc = JSON.parse(out.body) as { requests: { id: string; method: string; url: string }[] }
    expect(doc.requests).toHaveLength(2)
    expect(doc.requests[0]).toMatchObject({ id: '1', method: 'GET', url: 'Products(1)' })
    expect(doc.requests[1]).toMatchObject({ id: '2', method: 'GET', url: 'Products(2)' })
  })

  it('carries the atomicityGroup label and inlines a JSON body', () => {
    const out = serializeODataJsonBatch([
      { method: 'POST', url: 'Products', body: '{"Name":"Widget"}', atomicityGroup: 'cs1' },
      { method: 'PATCH', url: 'Products(1)', body: '{"Price":9}', atomicityGroup: 'cs1' }
    ])
    const doc = JSON.parse(out.body) as {
      requests: { atomicityGroup?: string; body?: unknown; headers?: Record<string, string> }[]
    }
    expect(doc.requests[0]?.atomicityGroup).toBe('cs1')
    expect(doc.requests[1]?.atomicityGroup).toBe('cs1')
    // Body inlined as a real JSON object, not a double-encoded string.
    expect(doc.requests[0]?.body).toEqual({ Name: 'Widget' })
    // Default content-type header added for the body-bearing entry.
    expect(doc.requests[0]?.headers?.['content-type']).toBe('application/json')
  })

  it('leaves a non-JSON body as a raw string', () => {
    const out = serializeODataJsonBatch([{ method: 'POST', url: 'Things', body: 'plain text' }])
    const doc = JSON.parse(out.body) as { requests: { body?: unknown }[] }
    expect(doc.requests[0]?.body).toBe('plain text')
  })
})

describe('parseODataJsonBatchResponse', () => {
  it('maps responses[] into the multipart-parser shape', () => {
    const raw = JSON.stringify({
      responses: [
        { id: '1', status: 200, headers: { 'Content-Type': 'application/json' }, body: { value: [] } },
        { id: '2', status: 404, body: { error: { code: 'NotFound' } } }
      ]
    })
    const out = parseODataJsonBatchResponse(raw)
    expect(out).toHaveLength(2)
    expect(out[0]?.status).toBe(200)
    expect(out[0]?.headers['content-type']).toBe('application/json')
    expect(out[0]?.body).toBe(JSON.stringify({ value: [] }))
    expect(out[1]?.status).toBe(404)
  })

  it('returns [] for malformed or non-batch JSON', () => {
    expect(parseODataJsonBatchResponse('not json')).toEqual([])
    expect(parseODataJsonBatchResponse('{"foo":1}')).toEqual([])
  })
})

describe('toRelativeBatchUrl', () => {
  it('strips the service root prefix and trailing slash', () => {
    expect(toRelativeBatchUrl('https://example.com/odata/Customers(1)', 'https://example.com/odata'))
      .toBe('Customers(1)')
  })

  it('handles a service root already ending with /', () => {
    expect(toRelativeBatchUrl('https://example.com/odata/People?$top=5', 'https://example.com/odata/'))
      .toBe('People?$top=5')
  })

  it('returns the URL unchanged when it does not start with the service root', () => {
    expect(toRelativeBatchUrl('https://other.com/Pets', 'https://example.com/odata'))
      .toBe('https://other.com/Pets')
  })

  it('returns the URL unchanged when serviceRoot is empty', () => {
    expect(toRelativeBatchUrl('https://example.com/odata/Pets', '')).toBe('https://example.com/odata/Pets')
  })

  it('already-relative URLs pass through unchanged', () => {
    expect(toRelativeBatchUrl('Pets(1)', 'https://example.com/odata')).toBe('Pets(1)')
  })
})

describe('serializeODataBatch — v4.01 relative URLs', () => {
  it('rewrites sub-request URLs to relative when serviceRoot is provided', () => {
    const out = serializeODataBatch(
      [{ method: 'GET', url: 'https://example.com/odata/Pets(1)' }],
      'b',
      { serviceRoot: 'https://example.com/odata' }
    )
    expect(out.body).toContain('GET Pets(1) HTTP/1.1')
    expect(out.body).not.toContain('GET https://example.com/odata/Pets(1)')
  })

  it('keeps absolute URLs when forceAbsoluteUrls is true', () => {
    const out = serializeODataBatch(
      [{ method: 'GET', url: 'https://example.com/odata/Pets(1)' }],
      'b',
      { serviceRoot: 'https://example.com/odata', forceAbsoluteUrls: true }
    )
    expect(out.body).toContain('GET https://example.com/odata/Pets(1) HTTP/1.1')
  })
})

describe('serializeODataJsonBatch — v4.01 relative URLs', () => {
  it('rewrites sub-request URLs to relative when serviceRoot is provided', () => {
    const out = serializeODataJsonBatch(
      [{ method: 'GET', url: 'https://example.com/odata/Pets' }],
      { serviceRoot: 'https://example.com/odata' }
    )
    const doc = JSON.parse(out.body) as { requests: { url: string }[] }
    expect(doc.requests[0]?.url).toBe('Pets')
  })

  it('keeps absolute URLs when forceAbsoluteUrls is true', () => {
    const out = serializeODataJsonBatch(
      [{ method: 'GET', url: 'https://example.com/odata/Pets' }],
      { serviceRoot: 'https://example.com/odata', forceAbsoluteUrls: true }
    )
    const doc = JSON.parse(out.body) as { requests: { url: string }[] }
    expect(doc.requests[0]?.url).toBe('https://example.com/odata/Pets')
  })
})
