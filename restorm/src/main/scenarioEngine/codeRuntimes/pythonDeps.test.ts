import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({ app: { getPath: (): string => tmpdir() } }))

import { isPureWheel, parseRequiredDistNames, readClosureWheels, writeClosureManifest } from './pythonDeps'

describe('isPureWheel', () => {
  it('accepts a pure-Python wheel (abi none, platform any)', () => {
    expect(isPureWheel('requests-2.31.0-py3-none-any.whl')).toBe(true)
    expect(isPureWheel('idna-3.7-py3-none-any.whl')).toBe(true)
    expect(isPureWheel('pkg-1.0-py3-none-any.whl'.replace('py3', 'py2.py3'))).toBe(true)
  })

  it('rejects a platform-specific / C-extension wheel (WASM can only load pure-Python)', () => {
    expect(isPureWheel('numpy-1.26.4-cp311-cp311-manylinux_2_17_x86_64.whl')).toBe(false)
    expect(isPureWheel('lxml-5.2.1-cp312-cp312-win_amd64.whl')).toBe(false)
  })

  it('rejects a malformed / too-short filename', () => {
    expect(isPureWheel('weird.whl')).toBe(false)
    expect(isPureWheel('a-b.whl')).toBe(false)
  })
})

describe('parseRequiredDistNames', () => {
  it('extracts unconditional dependency names, stripping version specifiers', () => {
    const meta = [
      'Name: requests',
      'Requires-Dist: charset-normalizer <4,>=2',
      'Requires-Dist: idna (>=2.5,<4)',
      'Requires-Dist: urllib3>=1.21.1',
      'Requires-Dist: certifi >= 2017.4.17'
    ].join('\n')
    expect(parseRequiredDistNames(meta)).toEqual(['charset-normalizer', 'idna', 'urllib3', 'certifi'])
  })

  it('skips marker / extra-gated (optional) dependencies', () => {
    const meta = [
      'Requires-Dist: core-dep',
      'Requires-Dist: PySocks !=1.5.7 ; extra == "socks"',
      'Requires-Dist: colorama ; sys_platform == "win32"'
    ].join('\n')
    expect(parseRequiredDistNames(meta)).toEqual(['core-dep'])
  })

  it('dedups repeated names and ignores non-Requires-Dist lines', () => {
    const meta = 'Requires-Dist: a\nSummary: whatever\nRequires-Dist: a\nRequires-Dist: b'
    expect(parseRequiredDistNames(meta)).toEqual(['a', 'b'])
  })
})

describe('closure manifest', () => {
  let cacheDir = ''
  const wheel = (key: string, file: string): void => {
    const dir = join(cacheDir, key)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, file), Buffer.from([0]))
  }
  beforeEach(() => { cacheDir = mkdtempSync(join(tmpdir(), 'py-deps-')) })
  afterEach(() => { rmSync(cacheDir, { recursive: true, force: true }) })

  it('records a top-level spec closure and reads back exactly its wheels', () => {
    const root = { name: 'requests', version: '2.31.0' }
    wheel('requests@2.31.0', 'requests-2.31.0-py3-none-any.whl')
    wheel('idna@3.7', 'idna-3.7-py3-none-any.whl')
    // A sibling package cached by ANOTHER node — must NOT leak into this closure.
    wheel('flask@3.0.0', 'flask-3.0.0-py3-none-any.whl')
    writeClosureManifest(cacheDir, root, ['requests@2.31.0', 'idna@3.7'])
    const wheels = readClosureWheels(cacheDir, root).map((p) => p.split(/[/\\]/).pop())
    expect(wheels.sort()).toEqual(['idna-3.7-py3-none-any.whl', 'requests-2.31.0-py3-none-any.whl'])
  })

  it('falls back to the spec own wheels when no manifest exists', () => {
    const root = { name: 'solo', version: '1.0.0' }
    wheel('solo@1.0.0', 'solo-1.0.0-py3-none-any.whl')
    const wheels = readClosureWheels(cacheDir, root).map((p) => p.split(/[/\\]/).pop())
    expect(wheels).toEqual(['solo-1.0.0-py3-none-any.whl'])
  })
})
