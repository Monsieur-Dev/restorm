import { describe, it, expect, vi } from 'vitest'
import { initRendererCrashReporting, type CrashArmedStatePort } from './initRendererCrashReporting'
import type { CrashArmedState } from '../../../shared/crash/crashTypes'

const ARMED: CrashArmedState = { armed: true, reason: 'consent-granted' }
const DISARMED: CrashArmedState = { armed: false, reason: 'consent-declined' }
const UNANSWERED: CrashArmedState = { armed: false, reason: 'consent-unanswered' }

/** A port whose push channel can be driven by the test. */
function makePort(initial: CrashArmedState | Promise<CrashArmedState>): {
  port: CrashArmedStatePort
  push: (state: CrashArmedState) => void
  unsubscribe: ReturnType<typeof vi.fn>
} {
  let listener: ((state: CrashArmedState) => void) | null = null
  const unsubscribe = vi.fn()
  return {
    port: {
      getArmedState: () => Promise.resolve(initial),
      onArmedStateChanged: (callback) => {
        listener = callback
        return unsubscribe
      }
    },
    push: (state) => { listener?.(state) },
    unsubscribe
  }
}

/** Lets the internal promise chain settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('initRendererCrashReporting', () => {
  it('does not initialise the SDK while the main process reports disarmed', async () => {
    const initSdk = vi.fn().mockResolvedValue(vi.fn())
    const { port } = makePort(DISARMED)

    initRendererCrashReporting({ api: port, initSdk })
    await settle()

    expect(initSdk).not.toHaveBeenCalled()
  })

  it('does not initialise while consent is unanswered', async () => {
    const initSdk = vi.fn().mockResolvedValue(vi.fn())
    const { port } = makePort(UNANSWERED)

    initRendererCrashReporting({ api: port, initSdk })
    await settle()

    expect(initSdk).not.toHaveBeenCalled()
  })

  it('initialises once the armed state resolves to true', async () => {
    const initSdk = vi.fn().mockResolvedValue(vi.fn())
    const { port } = makePort(ARMED)

    initRendererCrashReporting({ api: port, initSdk })
    await settle()

    expect(initSdk).toHaveBeenCalledTimes(1)
  })

  it('arms on a later grant without a restart', async () => {
    const initSdk = vi.fn().mockResolvedValue(vi.fn())
    const { port, push } = makePort(UNANSWERED)

    initRendererCrashReporting({ api: port, initSdk })
    await settle()
    expect(initSdk).not.toHaveBeenCalled()

    push(ARMED)
    await settle()

    expect(initSdk).toHaveBeenCalledTimes(1)
  })

  it('closes the client on revocation', async () => {
    const close = vi.fn().mockResolvedValue(undefined)
    const initSdk = vi.fn().mockResolvedValue(close)
    const { port, push } = makePort(ARMED)

    initRendererCrashReporting({ api: port, initSdk })
    await settle()

    push(DISARMED)
    await settle()

    expect(close).toHaveBeenCalledTimes(1)
  })

  it('initialises at most once per window, even across repeated grants', async () => {
    const initSdk = vi.fn().mockResolvedValue(vi.fn().mockResolvedValue(undefined))
    const { port, push } = makePort(ARMED)

    initRendererCrashReporting({ api: port, initSdk })
    await settle()

    push(DISARMED)
    await settle()
    push(ARMED)
    await settle()

    // Re-arming inside the same window deliberately does NOT resurrect the SDK:
    // the SDK's own init is guarded against running twice. Under-reporting until
    // the next launch is the correct direction for a privacy control to fail.
    expect(initSdk).toHaveBeenCalledTimes(1)
  })

  it('subscribes before reading, so a transition during the read is not lost', async () => {
    const initSdk = vi.fn().mockResolvedValue(vi.fn())
    let listener: ((state: CrashArmedState) => void) | null = null
    // Resolves the initial read only AFTER a grant has already been pushed.
    const port: CrashArmedStatePort = {
      getArmedState: () =>
        Promise.resolve().then(() => {
          listener?.(ARMED)
          return DISARMED
        }),
      onArmedStateChanged: (callback) => {
        listener = callback
        return vi.fn()
      }
    }

    initRendererCrashReporting({ api: port, initSdk })
    await settle()

    expect(initSdk).toHaveBeenCalledTimes(1)
  })

  it('survives an SDK that fails to initialise', async () => {
    const initSdk = vi.fn().mockRejectedValue(new Error('sdk exploded'))
    const log = vi.fn()
    const { port } = makePort(ARMED)

    expect(() => initRendererCrashReporting({ api: port, initSdk, log })).not.toThrow()
    await settle()

    expect(log).toHaveBeenCalledWith(
      'Renderer crash reporting failed to apply armed state',
      expect.objectContaining({ error: 'sdk exploded' })
    )
  })

  it('survives an armed-state read that rejects, and stays disarmed', async () => {
    const initSdk = vi.fn().mockResolvedValue(vi.fn())
    const log = vi.fn()
    const port: CrashArmedStatePort = {
      getArmedState: () => Promise.reject(new Error('ipc down')),
      onArmedStateChanged: () => vi.fn()
    }

    initRendererCrashReporting({ api: port, initSdk, log })
    await settle()

    expect(initSdk).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(
      'Renderer crash reporting could not read the armed state',
      expect.objectContaining({ error: 'ipc down' })
    )
  })

  it('detaches the subscription on teardown', async () => {
    const initSdk = vi.fn().mockResolvedValue(vi.fn())
    const { port, unsubscribe } = makePort(DISARMED)

    const teardown = initRendererCrashReporting({ api: port, initSdk })
    await settle()
    teardown()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
