import { describe, it, expect, afterEach } from 'vitest'
import { resolveFilePickerPath } from './filePicker'

afterEach(() => {
  delete (window as unknown as { restorm?: unknown }).restorm
})

describe('resolveFilePickerPath', () => {
  it('returns the absolute path from the restorm.file.getPathForFile bridge', () => {
    ;(window as unknown as { restorm?: { file: { getPathForFile: (file: File) => string } } }).restorm = {
      file: { getPathForFile: () => '/home/user/payload.bin' }
    }
    const file = new File(['bytes'], 'payload.bin')
    expect(resolveFilePickerPath(file)).toBe('/home/user/payload.bin')
  })

  it('falls back to file.name when the bridge returns an empty path', () => {
    ;(window as unknown as { restorm?: { file: { getPathForFile: (file: File) => string } } }).restorm = {
      file: { getPathForFile: () => '' }
    }
    const file = new File(['bytes'], 'blob-backed.bin')
    expect(resolveFilePickerPath(file)).toBe('blob-backed.bin')
  })

  it('falls back to file.name when the bridge is unavailable', () => {
    const file = new File(['bytes'], 'no-bridge.bin')
    expect(resolveFilePickerPath(file)).toBe('no-bridge.bin')
  })
})
