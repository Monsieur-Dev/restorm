// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Capture the options the harness passes to `new Worker(...)` without
// spawning a real worker thread.
const workerCtor = vi.hoisted(() => vi.fn())
vi.mock('node:worker_threads', () => ({
  Worker: class {
    on = vi.fn()
    postMessage = vi.fn()
    terminate = vi.fn(() => Promise.resolve(0))
    constructor(src: string, opts: unknown) { workerCtor(src, opts) }
  }
}))

import { runCodeWorker } from './codeWorkerHarness'

describe('runCodeWorker — resource limits', () => {
  beforeEach(() => workerCtor.mockClear())

  it('spawns the worker with a bounded memory resourceLimits', () => {
    // Fire and forget — the mocked worker never replies, so the run stays
    // pending; we only assert the construction options. (1ms timeout would
    // reject, but we don't await.)
    void runCodeWorker('/* worker src */', 'x = 1', {
      input: null,
      variables: {},
      timeoutMs: 1000
    }).catch(() => undefined)

    expect(workerCtor).toHaveBeenCalledTimes(1)
    const opts = workerCtor.mock.calls[0][1] as { resourceLimits?: { maxOldGenerationSizeMb?: number; maxYoungGenerationSizeMb?: number } }
    expect(opts.resourceLimits).toBeDefined()
    expect(opts.resourceLimits?.maxOldGenerationSizeMb).toBeGreaterThan(0)
    expect(opts.resourceLimits?.maxYoungGenerationSizeMb).toBeGreaterThan(0)
  })
})
