import { describe, it, expect, vi } from 'vitest'
import { makeBeforeSend, makeBeforeBreadcrumb, crashScrubOptions } from './sentryScrub'

/** A realistically-shaped Sentry event for an API client: the exception, the
 * stack, and the breadcrumb trail of the request that blew up. */
function makeEvent(): Record<string, unknown> {
  return {
    event_id: 'abc',
    release: 'restorm@0.1.19',
    exception: {
      values: [{
        type: 'Error',
        value: 'Request failed calling https://api.acme-internal.corp/v1/pay?token=sk_live_abcdef123456',
        stacktrace: {
          frames: [
            { filename: '/home/alice/projects/api/src/pay.ts', lineno: 42, function: 'send' },
            { filename: '/usr/lib/node/internal/modules.js', lineno: 1, function: 'require' }
          ]
        }
      }]
    },
    breadcrumbs: [{
      category: 'http',
      data: { url: 'https://api.acme-internal.corp/v1/pay', method: 'POST', status_code: 401 }
    }],
    request: {
      url: 'https://api.acme-internal.corp/v1/pay',
      headers: { Authorization: 'Bearer sk_live_abcdef123456', 'content-type': 'application/json' },
      data: { card: '4111111111111111' }
    },
    user: { email: 'alice@acme.corp', ip_address: '10.1.2.3' },
    contexts: { app: { app_version: '0.1.19' }, os: { name: 'Linux' } }
  }
}

describe('beforeSend — nothing sensitive survives', () => {
  it('strips every leak vector out of a realistic crash event', () => {
    const out = makeBeforeSend()(makeEvent())
    expect(out).not.toBeNull()
    const json = JSON.stringify(out)
    expect(json).not.toContain('sk_live_abcdef123456')
    expect(json).not.toContain('api.acme-internal.corp')
    expect(json).not.toContain('alice@acme.corp')
    expect(json).not.toContain('10.1.2.3')
    expect(json).not.toContain('4111111111111111')
    expect(json).not.toContain('/home/alice')
  })

  it('keeps what makes a report actionable', () => {
    const out = makeBeforeSend()(makeEvent()) as Record<string, unknown>
    // Release + technical context survive — a crash report with nothing left in
    // it is not privacy, it is just a wasted send.
    expect(out['release']).toBe('restorm@0.1.19')
    expect(out['contexts']).toEqual({ app: { app_version: '0.1.19' }, os: { name: 'Linux' } })
    const frames = JSON.stringify(out['exception'])
    expect(frames).toContain('~/projects/api/src/pay.ts')
    expect(frames).toContain('/usr/lib/node/internal/modules.js')
    expect(frames).toContain('"lineno":42')
  })

  it('DROPS the event rather than sending it when scrubbing cannot complete', () => {
    const onDropped = vi.fn()
    const event = {} as Record<string, unknown>
    // An exploding getter is an unknown failure mode. The gate's whole purpose
    // is that "we could not verify this is clean" resolves to "do not send",
    // never to "send it anyway".
    Object.defineProperty(event, 'requestHeaders', {
      enumerable: true,
      get(): never { throw new Error('exploding getter') }
    })

    expect(makeBeforeSend({ onDropped })(event)).toBeNull()
    expect(onDropped).toHaveBeenCalledTimes(1)

    const [message, fields] = onDropped.mock.calls[0] as [string, Record<string, unknown>]
    expect(message).toContain('dropped')
    expect(fields['kind']).toBe('event')
    // The diagnostic names the failure, never the payload we just refused to send.
    expect(JSON.stringify(fields)).not.toContain('requestHeaders')
  })

  it('drops a breadcrumb on the same terms', () => {
    const onDropped = vi.fn()
    const breadcrumb = {} as Record<string, unknown>
    // NOT keyed `data`: a body key is redacted by NAME, so the scrubber never
    // reads the value and a hostile getter there never fires. `message` is
    // walked, so it exercises the drop path.
    Object.defineProperty(breadcrumb, 'message', {
      enumerable: true,
      get(): never { throw new Error('exploding getter') }
    })
    expect(makeBeforeBreadcrumb({ onDropped })(breadcrumb)).toBeNull()
    expect((onDropped.mock.calls[0] as [string, Record<string, unknown>])[1]['kind']).toBe('breadcrumb')
  })

  it('redacts a body key by NAME, without evaluating its value', () => {
    // Worth pinning: the body rule fires on the key, so a getter that would
    // throw (or worse, have side effects) is never invoked.
    let read = false
    const event = {} as Record<string, unknown>
    Object.defineProperty(event, 'data', {
      enumerable: true,
      get(): unknown { read = true; return { card: '4111111111111111' } }
    })
    const out = makeBeforeSend()(event) as Record<string, unknown>
    expect(read).toBe(false)
    expect(out['data']).toBe('[redacted-body]')
  })
})

describe('beforeBreadcrumb — the richest leak vector', () => {
  it('strips the URL of a captured HTTP breadcrumb', () => {
    const out = makeBeforeBreadcrumb()({
      category: 'http',
      data: { url: 'https://api.acme-internal.corp/v1/pay?token=abc', method: 'POST' }
    })
    const json = JSON.stringify(out)
    expect(json).not.toContain('api.acme-internal.corp')
    expect(json).not.toContain('token=abc')
  })

  it('strips an Authorization header recorded on a fetch breadcrumb', () => {
    const out = makeBeforeBreadcrumb()({
      category: 'fetch',
      data: { Authorization: 'Bearer sk_live_abcdef123456' }
    })
    expect(JSON.stringify(out)).not.toContain('sk_live_abcdef123456')
  })
})

describe('crashScrubOptions — the declared policy', () => {
  it('strips URLs entirely by default', () => {
    expect(crashScrubOptions().urlPolicy).toBe('strip')
  })

  it('lets a caller override the policy without losing the rest', () => {
    const opts = crashScrubOptions({ urlPolicy: 'host' })
    expect(opts.urlPolicy).toBe('host')
    expect(opts.homeDir).toBe(crashScrubOptions().homeDir)
  })

  it('preserves Sentry\'s structural identifiers so the ingest does not reject the event', () => {
    expect(crashScrubOptions().preserveKeys).toEqual(['event_id', 'trace_id', 'span_id'])
  })

  it('caps payload strings so bulk user content (an imported spec) cannot ride into a report', () => {
    expect(crashScrubOptions().maxStringLength).toBe(4096)
    // End-to-end through beforeSend: a document-sized string is truncated, not
    // sent. Clean prose (no secret/URL shapes) so nothing but the length cap
    // acts on it.
    const bulk = 'the imported specification described many operations. '.repeat(400) // ~21k chars
    const event = { message: bulk } as Record<string, unknown>
    const out = makeBeforeSend()(event) as Record<string, unknown>
    expect(out).not.toBeNull()
    expect((out.message as string).length).toBeLessThan(4200)
    expect(out.message).toContain(' chars]')
  })
})

describe('beforeSend — Sentry\'s own identifiers survive the scrub', () => {
  // Regression: Sentry's event_id / trace_id are 32-hex, the exact shape the
  // entropy catch-all treats as a token. Redacting them yields an invalid
  // event_id and the ingest endpoint rejects the whole event with HTTP 400 —
  // so a scrub that "cleans" them silently drops every crash report.
  it('keeps a 32-hex event_id and trace_id verbatim while still redacting a real token', () => {
    const eventId = '36a8ee150f1a443da01e6a6018d79244'
    const traceId = '4cef6038a11343c09026b35a09aa4505'
    const secret = 'sk_live_'.padEnd(40, 'z')
    const out = makeBeforeSend()({
      event_id: eventId,
      contexts: { trace: { trace_id: traceId, span_id: 'b61eedba07102474' } },
      message: `boom with ${secret}`
    }) as Record<string, unknown>
    expect(out['event_id']).toBe(eventId)
    expect((out['contexts'] as { trace: { trace_id: string } }).trace.trace_id).toBe(traceId)
    // The carve-out is exact: a genuine secret in free text is still redacted.
    expect(JSON.stringify(out)).not.toContain(secret)
  })
})
