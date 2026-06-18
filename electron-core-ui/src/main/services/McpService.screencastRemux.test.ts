import { describe, it, expect, vi, beforeEach } from 'vitest'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// spawnSync is the only side effect we want to control: we never invoke a real
// ffmpeg in unit tests. The mock lets each case drive the remux outcome (binary
// present + succeeds, binary present + fails, binary absent → ENOENT) and assert
// which executable + args the caller passed.
const { spawnSyncMock } = vi.hoisted(() => ({ spawnSyncMock: vi.fn() }))
vi.mock('node:child_process', () => ({ spawnSync: spawnSyncMock }))

vi.mock('electron', () => ({
  app: { on: vi.fn(), off: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn(), showMessageBox: vi.fn() },
  protocol: { handle: vi.fn() },
  net: { fetch: vi.fn() }
}))
vi.mock('./LoggerService', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

import { remuxScreencastToMp4 } from './McpService'

describe('remuxScreencastToMp4 (ffmpeg present → mp4, absent → webm fallback)', () => {
  const webmPath = join(tmpdir(), 'ecu-screencast-remux-test.webm')
  const mp4Path = join(tmpdir(), 'ecu-screencast-remux-test.mp4')

  beforeEach(() => {
    spawnSyncMock.mockReset()
    rmSync(webmPath, { force: true })
    rmSync(mp4Path, { force: true })
  })

  it('returns the mp4 path when ffmpeg succeeds and the output file exists', () => {
    // ffmpeg is present and exits 0; emulate it by materialising the mp4.
    spawnSyncMock.mockImplementation((_cmd: string, _args: string[]) => {
      writeFileSync(mp4Path, 'fake-mp4-bytes')
      return { status: 0, error: undefined }
    })

    const result = remuxScreencastToMp4(webmPath, mp4Path)

    expect(result).toBe(mp4Path)
    expect(spawnSyncMock).toHaveBeenCalledTimes(1)
  })

  it('invokes a bare "ffmpeg" (PATH lookup) when no path is injected', () => {
    spawnSyncMock.mockImplementation(() => {
      writeFileSync(mp4Path, 'x')
      return { status: 0, error: undefined }
    })

    remuxScreencastToMp4(webmPath, mp4Path)

    const [cmd, args] = spawnSyncMock.mock.calls[0] as [string, string[]]
    expect(cmd).toBe('ffmpeg')
    // The recipe must reach the resolved binary verbatim (input + output paths).
    expect(args).toEqual(expect.arrayContaining(['-i', webmPath, mp4Path]))
  })

  it('invokes the injected ffmpeg path when the app provides one', () => {
    const injected = '/opt/restorm/resources/ffmpeg'
    spawnSyncMock.mockImplementation(() => {
      writeFileSync(mp4Path, 'x')
      return { status: 0, error: undefined }
    })

    remuxScreencastToMp4(webmPath, mp4Path, injected)

    const [cmd] = spawnSyncMock.mock.calls[0] as [string]
    expect(cmd).toBe(injected)
  })

  it('falls back to webm (returns null) when ffmpeg exits non-zero', () => {
    // Present but failed: no mp4 produced.
    spawnSyncMock.mockReturnValue({ status: 1, error: undefined })

    const result = remuxScreencastToMp4(webmPath, mp4Path)

    expect(result).toBeNull()
    expect(existsSync(mp4Path)).toBe(false)
  })

  it('falls back to webm (returns null) when ffmpeg is absent (spawnSync ENOENT error object)', () => {
    // spawnSync reports a missing binary via the `error` field, status null.
    spawnSyncMock.mockReturnValue({ status: null, error: new Error('spawnSync ffmpeg ENOENT') })

    const result = remuxScreencastToMp4(webmPath, mp4Path)

    expect(result).toBeNull()
  })

  it('falls back to webm (returns null) when spawnSync throws', () => {
    spawnSyncMock.mockImplementation(() => {
      throw new Error('unexpected spawn failure')
    })

    const result = remuxScreencastToMp4(webmPath, mp4Path)

    expect(result).toBeNull()
  })
})
