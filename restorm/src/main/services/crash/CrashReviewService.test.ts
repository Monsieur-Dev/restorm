import { describe, it, expect, vi } from 'vitest'
import { CrashReviewService, type CrashReviewPort } from './CrashReviewService'
import { crashReviewMode } from './crashReviewDecision'
import type { ConsentDecision } from 'electron-core-ui/main'
import type { CrashReviewRequest } from '../../../shared/crash/crashTypes'

const REQUEST: CrashReviewRequest = { id: 'r1', fingerprint: 'TypeError@boom', payload: '{}' }

function makePort(overrides: Partial<CrashReviewPort> = {}): CrashReviewPort & {
  asked: CrashReviewRequest[]
} {
  const asked: CrashReviewRequest[] = []
  return {
    asked,
    canAsk: overrides.canAsk ?? ((): boolean => true),
    ask: overrides.ask ?? ((request): Promise<boolean> => { asked.push(request); return Promise.resolve(true) })
  }
}

function consent(over: Partial<ConsentDecision> = {}): ConsentDecision {
  return {
    gate: 'crash', granted: true, consentedAt: null, policyVersion: null, source: 'user', ...over
  }
}

describe('crashReviewMode', () => {
  it('asks a user who chose to send', () => {
    expect(crashReviewMode({ consent: consent({ source: 'user' }), reviewEnabled: true })).toBe('ask')
  })

  it('does not ask an account whose plan mandates reporting', () => {
    // Offering a "don't send" that cannot be honoured would be worse than not
    // offering one.
    expect(crashReviewMode({ consent: consent({ source: 'forced-on' }), reviewEnabled: true })).toBe('direct')
  })

  it('does not ask once the user has waived the per-report step', () => {
    expect(crashReviewMode({ consent: consent({ source: 'user' }), reviewEnabled: false })).toBe('direct')
  })

  it('does not ask when consent is unreadable', () => {
    expect(crashReviewMode({ consent: null, reviewEnabled: true })).toBe('direct')
  })
})

describe('CrashReviewService', () => {
  it('sends without asking in direct mode', async () => {
    const port = makePort()
    const service = new CrashReviewService({ port })
    expect(await service.review('direct', REQUEST)).toBe(true)
    expect(port.asked).toHaveLength(0)
  })

  it('sends when the user allows it', async () => {
    const port = makePort()
    const service = new CrashReviewService({ port })
    expect(await service.review('ask', REQUEST)).toBe(true)
    expect(port.asked).toEqual([REQUEST])
  })

  it('discards when the user refuses', async () => {
    const port = makePort({ ask: () => Promise.resolve(false) })
    const service = new CrashReviewService({ port })
    expect(await service.review('ask', REQUEST)).toBe(false)
  })

  it('DISCARDS a second report while one is already on screen — never stacks', async () => {
    // The extras are dropped rather than queued or merged: the user was told
    // they would see exactly what is sent before each report, and a batched
    // approval would send payloads nobody looked at.
    let release: ((send: boolean) => void) | null = null
    const port = makePort({ ask: () => new Promise<boolean>((resolve) => { release = resolve }) })
    const service = new CrashReviewService({ port })

    const first = service.review('ask', REQUEST)
    expect(service.isPending()).toBe(true)
    const second = await service.review('ask', { ...REQUEST, id: 'r2' })

    expect(second).toBe(false)
    release?.(true)
    expect(await first).toBe(true)
  })

  it('accepts a new report once the previous one has been answered', async () => {
    const port = makePort()
    const service = new CrashReviewService({ port })
    await service.review('ask', REQUEST)
    await service.review('ask', { ...REQUEST, id: 'r2' })
    expect(port.asked.map((r) => r.id)).toEqual(['r1', 'r2'])
  })

  it('discards when there is no window to ask with', async () => {
    // Shutdown, or before any window exists. Unasked means unsent.
    const port = makePort({ canAsk: () => false })
    const service = new CrashReviewService({ port })
    expect(await service.review('ask', REQUEST)).toBe(false)
  })

  it('discards when the review itself fails, and clears the slot', async () => {
    const port = makePort({ ask: () => Promise.reject(new Error('window vanished')) })
    const log = vi.fn()
    const service = new CrashReviewService({ port, log })
    expect(await service.review('ask', REQUEST)).toBe(false)
    // A wedged slot would silently discard every later report.
    expect(service.isPending()).toBe(false)
    expect(log).toHaveBeenCalled()
  })
})
