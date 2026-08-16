import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { startAuthStoreWatch, type WatchImpl } from './authStoreWatch'

/**
 * The watcher's whole contract: watch the PARENT directory (an atomic rename
 * replaces the file's inode, and a file-level watch would go silent), coalesce
 * a burst of events into ONE callback, ignore other files, and die quietly.
 */
describe('startAuthStoreWatch', () => {
  let listeners: ((eventType: string, filename: string | Buffer | null) => void)[]
  let watchedDirs: string[]
  let closed: number

  const fakeWatch: WatchImpl = (dir, listener) => {
    watchedDirs.push(dir)
    listeners.push(listener)
    return { close: () => { closed += 1 } }
  }

  /** Fire an event on the first (and only) registered listener. */
  const fire = (eventType: string, filename: string | null): void => {
    const listener = listeners[0]
    if (!listener) throw new Error('no watcher registered')
    listener(eventType, filename)
  }

  beforeEach(() => {
    vi.useFakeTimers()
    listeners = []
    watchedDirs = []
    closed = 0
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('watches the parent directory, not the file itself', () => {
    startAuthStoreWatch({
      filePath: '/data/userData/auth-session.dat',
      onChange: () => undefined,
      watchImpl: fakeWatch
    })
    expect(watchedDirs).toEqual(['/data/userData'])
  })

  it('coalesces a rename+change burst into a single onChange', () => {
    const onChange = vi.fn()
    startAuthStoreWatch({
      filePath: '/u/auth-session.dat',
      onChange,
      debounceMs: 200,
      watchImpl: fakeWatch
    })
    // The burst an atomic write produces: rename (temp → file) then change.
    fire('rename', 'auth-session.dat')
    fire('change', 'auth-session.dat')
    fire('change', 'auth-session.dat')
    expect(onChange).not.toHaveBeenCalled()
    vi.advanceTimersByTime(199)
    expect(onChange).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('a fresh event during the quiet window restarts the debounce', () => {
    const onChange = vi.fn()
    startAuthStoreWatch({ filePath: '/u/a.dat', onChange, debounceMs: 100, watchImpl: fakeWatch })
    fire('change', 'a.dat')
    vi.advanceTimersByTime(80)
    fire('change', 'a.dat')
    vi.advanceTimersByTime(80)
    expect(onChange).not.toHaveBeenCalled()
    vi.advanceTimersByTime(20)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('ignores events for other files in the directory', () => {
    const onChange = vi.fn()
    startAuthStoreWatch({ filePath: '/u/auth-session.dat', onChange, debounceMs: 50, watchImpl: fakeWatch })
    fire('change', 'config.json')
    fire('rename', 'auth-session.dat.tmp-x')
    vi.advanceTimersByTime(100)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('treats a null filename as potentially ours (platforms that omit it)', () => {
    const onChange = vi.fn()
    startAuthStoreWatch({ filePath: '/u/a.dat', onChange, debounceMs: 50, watchImpl: fakeWatch })
    fire('change', null)
    vi.advanceTimersByTime(50)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('fires again for a later, separate burst (deletion then re-creation)', () => {
    const onChange = vi.fn()
    startAuthStoreWatch({ filePath: '/u/a.dat', onChange, debounceMs: 50, watchImpl: fakeWatch })
    fire('rename', 'a.dat') // logout: file removed
    vi.advanceTimersByTime(50)
    fire('rename', 'a.dat') // next login: file re-created
    fire('change', 'a.dat')
    vi.advanceTimersByTime(50)
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('stop() closes the watcher and cancels a pending callback', () => {
    const onChange = vi.fn()
    const handle = startAuthStoreWatch({ filePath: '/u/a.dat', onChange, debounceMs: 50, watchImpl: fakeWatch })
    fire('change', 'a.dat')
    handle.stop()
    vi.advanceTimersByTime(100)
    expect(onChange).not.toHaveBeenCalled()
    expect(closed).toBe(1)
    handle.stop() // idempotent
    expect(closed).toBe(1)
  })

  it('a watch that cannot be established reports the error instead of throwing', () => {
    const onError = vi.fn()
    const handle = startAuthStoreWatch({
      filePath: '/u/a.dat',
      onChange: () => undefined,
      watchImpl: () => { throw new Error('EMFILE') },
      onError
    })
    expect(onError).toHaveBeenCalledTimes(1)
    handle.stop() // still safe with no live watcher
  })
})
