import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod/v4'

// Mock electron's ipcMain before importing the module under test
const mockHandle = vi.fn()
vi.mock('electron', () => ({
  ipcMain: { handle: (...args: unknown[]) => { mockHandle(...args) } }
}))

// Mock logger
vi.mock('../services/LoggerService', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  }
}))

import { validatedHandle } from './validate'

describe('validatedHandle', () => {
  beforeEach(() => {
    mockHandle.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('registers a handler with ipcMain.handle', () => {
    const schema = z.tuple([z.string()])
    validatedHandle('test:channel', schema, () => 'ok')
    expect(mockHandle).toHaveBeenCalledWith('test:channel', expect.any(Function))
  })

  it('calls the handler when args pass validation', async () => {
    const schema = z.tuple([z.string()])
    const handler = vi.fn().mockReturnValue('result')
    validatedHandle('test:valid', schema, handler)

    const registeredFn = mockHandle.mock.calls[0]?.[1] as (...args: unknown[]) => Promise<unknown>
    const fakeEvent = {} as never
    const result = await registeredFn(fakeEvent, 'hello')

    expect(handler).toHaveBeenCalledWith(fakeEvent, ['hello'])
    expect(result).toBe('result')
  })

  it('rejects when args fail validation', async () => {
    const schema = z.tuple([z.string()])
    const handler = vi.fn()
    validatedHandle('test:invalid', schema, handler)

    const registeredFn = mockHandle.mock.calls[0]?.[1] as (...args: unknown[]) => Promise<unknown>
    const fakeEvent = {} as never

    await expect(registeredFn(fakeEvent, 123)).rejects.toThrow('IPC validation error on "test:invalid"')
    expect(handler).not.toHaveBeenCalled()
  })

  it('validates complex schemas', async () => {
    const schema = z.tuple([
      z.object({ level: z.enum(['debug', 'info', 'warn', 'error']), message: z.string() })
    ])
    const handler = vi.fn().mockReturnValue(undefined)
    validatedHandle('test:complex', schema, handler)

    const registeredFn = mockHandle.mock.calls[0]?.[1] as (...args: unknown[]) => Promise<unknown>
    const fakeEvent = {} as never

    // Valid payload
    await registeredFn(fakeEvent, { level: 'info', message: 'test' })
    expect(handler).toHaveBeenCalledTimes(1)

    // Invalid payload — wrong enum value
    await expect(registeredFn(fakeEvent, { level: 'invalid', message: 'test' })).rejects.toThrow('IPC validation error')
  })

  it('validates tuple with multiple args', async () => {
    const schema = z.tuple([z.string(), z.unknown()])
    const handler = vi.fn().mockReturnValue(true)
    validatedHandle('test:multi', schema, handler)

    const registeredFn = mockHandle.mock.calls[0]?.[1] as (...args: unknown[]) => Promise<unknown>
    const fakeEvent = {} as never

    await registeredFn(fakeEvent, 'key', { data: 42 })
    expect(handler).toHaveBeenCalledWith(fakeEvent, ['key', { data: 42 }])
  })

  it('rejects when required args are missing', async () => {
    const schema = z.tuple([z.string()])
    const handler = vi.fn()
    validatedHandle('test:missing', schema, handler)

    const registeredFn = mockHandle.mock.calls[0]?.[1] as (...args: unknown[]) => Promise<unknown>
    const fakeEvent = {} as never

    await expect(registeredFn(fakeEvent)).rejects.toThrow('IPC validation error')
    expect(handler).not.toHaveBeenCalled()
  })
})
