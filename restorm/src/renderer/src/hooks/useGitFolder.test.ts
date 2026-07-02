import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useGitFolder } from './useGitFolder'

describe('useGitFolder', () => {
  it('returns null when no file is open', () => {
    const { result } = renderHook(() => useGitFolder(null))
    expect(result.current).toBeNull()
  })

  it('strips the file name for a single-file .restorm project (POSIX path)', () => {
    const { result } = renderHook(() => useGitFolder('/home/user/projects/demo/api.restorm'))
    expect(result.current).toBe('/home/user/projects/demo')
  })

  it('strips the file name for a single-file .restorm project (Windows path)', () => {
    const { result } = renderHook(() => useGitFolder('C:\\Users\\demo\\project\\api.restorm'))
    expect(result.current).toBe('C:\\Users\\demo\\project')
  })

  it('returns the path itself for a legacy folder-mode project (no .restorm extension)', () => {
    const { result } = renderHook(() => useGitFolder('/home/user/projects/demo-folder'))
    expect(result.current).toBe('/home/user/projects/demo-folder')
  })

  it('falls back to the raw path when a .restorm file has no path separator', () => {
    const { result } = renderHook(() => useGitFolder('api.restorm'))
    expect(result.current).toBe('api.restorm')
  })
})
