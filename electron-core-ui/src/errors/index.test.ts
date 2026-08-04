import { describe, it, expect } from 'vitest'
import {
  FileSystemError,
  PersistenceError,
  IpcError,
  errorMeta,
  classifySaveFailure
} from './index'

describe('FileSystemError', () => {
  it('sets name, message, and code', () => {
    const err = new FileSystemError('read failed', 'FS_READ_FAILED')
    expect(err.name).toBe('FileSystemError')
    expect(err.message).toBe('read failed')
    expect(err.code).toBe('FS_READ_FAILED')
    expect(err).toBeInstanceOf(Error)
  })

  it('preserves cause chain', () => {
    const original = new Error('ENOENT')
    const err = new FileSystemError('file not found', 'FS_NOT_FOUND', { cause: original })
    expect(err.cause).toBe(original)
  })

  it('supports all error codes', () => {
    const codes = ['FS_READ_FAILED', 'FS_WRITE_FAILED', 'FS_NOT_FOUND', 'FS_PARSE_FAILED'] as const
    for (const code of codes) {
      const err = new FileSystemError('test', code)
      expect(err.code).toBe(code)
    }
  })
})

describe('PersistenceError', () => {
  it('sets name, message, and code', () => {
    const err = new PersistenceError('load failed', 'PERSIST_LOAD_FAILED')
    expect(err.name).toBe('PersistenceError')
    expect(err.message).toBe('load failed')
    expect(err.code).toBe('PERSIST_LOAD_FAILED')
    expect(err).toBeInstanceOf(Error)
  })

  it('preserves cause chain', () => {
    const original = new SyntaxError('Unexpected token')
    const err = new PersistenceError('parse error', 'PERSIST_LOAD_FAILED', { cause: original })
    expect(err.cause).toBe(original)
  })

  it('supports all error codes', () => {
    const codes = ['PERSIST_LOAD_FAILED', 'PERSIST_SAVE_FAILED'] as const
    for (const code of codes) {
      const err = new PersistenceError('test', code)
      expect(err.code).toBe(code)
    }
  })
})

describe('IpcError', () => {
  it('sets name, message, and code', () => {
    const err = new IpcError('emit failed', 'IPC_EMIT_FAILED')
    expect(err.name).toBe('IpcError')
    expect(err.message).toBe('emit failed')
    expect(err.code).toBe('IPC_EMIT_FAILED')
    expect(err).toBeInstanceOf(Error)
  })

  it('preserves cause chain', () => {
    const original = new TypeError('handler is not a function')
    const err = new IpcError('handler error', 'IPC_HANDLER_FAILED', { cause: original })
    expect(err.cause).toBe(original)
  })

  it('supports all error codes', () => {
    const codes = ['IPC_EMIT_FAILED', 'IPC_HANDLER_FAILED'] as const
    for (const code of codes) {
      const err = new IpcError('test', code)
      expect(err.code).toBe(code)
    }
  })
})

describe('errorMeta', () => {
  it('extracts structured info from a standard Error', () => {
    const err = new Error('something broke')
    const meta = errorMeta(err)
    expect(meta).toEqual({
      error: 'something broke',
      errorName: 'Error'
    })
  })

  it('includes cause when present', () => {
    const cause = new Error('root cause')
    const err = new Error('wrapper', { cause })
    const meta = errorMeta(err)
    expect(meta['cause']).toBe(cause.message)
  })

  it('includes code for typed errors', () => {
    const err = new FileSystemError('read failed', 'FS_READ_FAILED')
    const meta = errorMeta(err)
    expect(meta).toEqual({
      error: 'read failed',
      errorName: 'FileSystemError',
      code: 'FS_READ_FAILED'
    })
  })

  it('handles non-Error values', () => {
    expect(errorMeta('string error')).toEqual({ error: 'string error' })
    expect(errorMeta(42)).toEqual({ error: '42' })
    expect(errorMeta(null)).toEqual({ error: 'null' })
    expect(errorMeta(undefined)).toEqual({ error: 'undefined' })
  })

  it('includes all fields for a fully-populated typed error', () => {
    const cause = new Error('disk full')
    const err = new PersistenceError('save failed', 'PERSIST_SAVE_FAILED', { cause })
    const meta = errorMeta(err)
    expect(meta).toEqual({
      error: 'save failed',
      errorName: 'PersistenceError',
      cause: 'disk full',
      code: 'PERSIST_SAVE_FAILED'
    })
  })
})

describe('classifySaveFailure', () => {
  it('names the cause from an fs errno', () => {
    expect(classifySaveFailure(Object.assign(new Error('nope'), { code: 'EACCES' }))).toBe('permission-denied')
    expect(classifySaveFailure(Object.assign(new Error('nope'), { code: 'ENOSPC' }))).toBe('disk-full')
    expect(classifySaveFailure(Object.assign(new Error('nope'), { code: 'EROFS' }))).toBe('read-only-location')
    expect(classifySaveFailure(Object.assign(new Error('nope'), { code: 'EPERM' }))).toBe('permission-denied')
    expect(classifySaveFailure(Object.assign(new Error('nope'), { code: 'ENOENT' }))).toBe('path-missing')
    expect(classifySaveFailure(Object.assign(new Error('nope'), { code: 'EBUSY' }))).toBe('file-busy')
    expect(classifySaveFailure(Object.assign(new Error('nope'), { code: 'EDQUOT' }))).toBe('quota-exceeded')
  })

  it('reads through the wrapper the save path adds', () => {
    // The errno rides on the original fs error; callers wrap it in a
    // FileSystemError before rethrowing, and the wrapper's own code is
    // not a cause anyone can act on.
    const cause = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
    const wrapped = new FileSystemError('Failed to save file', 'FS_WRITE_FAILED', { cause })
    expect(classifySaveFailure(wrapped)).toBe('permission-denied')
  })

  it('recognises the refusal to overwrite a read-only target', () => {
    // The pre-flight throws its own code; the save path wraps it. The
    // wrapper's own code names no cause, so the walk has to see past it.
    const cause = new FileSystemError('not writable', 'FS_TARGET_READ_ONLY')
    const wrapped = new FileSystemError('Failed to save file', 'FS_WRITE_FAILED', { cause })
    expect(classifySaveFailure(wrapped)).toBe('read-only-file')
  })

  it('falls back to unknown for anything it cannot name', () => {
    expect(classifySaveFailure(new Error('mystery'))).toBe('unknown')
    expect(classifySaveFailure(Object.assign(new Error('x'), { code: 'EWEIRD' }))).toBe('unknown')
    expect(classifySaveFailure('not even an error')).toBe('unknown')
    expect(classifySaveFailure(null)).toBe('unknown')
  })

  it('terminates on a cause chain that loops back on itself', () => {
    const a = new Error('a')
    const b = new Error('b')
    Object.defineProperty(a, 'cause', { value: b })
    Object.defineProperty(b, 'cause', { value: a })
    expect(classifySaveFailure(a)).toBe('unknown')
  })
})
