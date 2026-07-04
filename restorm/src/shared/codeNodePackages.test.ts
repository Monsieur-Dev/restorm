import { describe, expect, it } from 'vitest'
import { npmPackageGlobalName } from './codeNodePackages'

describe('npmPackageGlobalName', () => {
  it('leaves an already-valid identifier untouched', () => {
    expect(npmPackageGlobalName('lodash')).toBe('lodash')
  })

  it('snake-cases hyphens', () => {
    expect(npmPackageGlobalName('just-snake-case')).toBe('just_snake_case')
  })

  it('snake-cases a scoped package name', () => {
    expect(npmPackageGlobalName('@babel/core')).toBe('_babel_core')
  })

  it('snake-cases dots', () => {
    expect(npmPackageGlobalName('left.pad')).toBe('left_pad')
  })

  it('prefixes a leading digit (identifiers cannot start with one)', () => {
    expect(npmPackageGlobalName('7zip')).toBe('_7zip')
  })

  it('falls back to a placeholder for an empty name', () => {
    expect(npmPackageGlobalName('')).toBe('_pkg')
  })
})
