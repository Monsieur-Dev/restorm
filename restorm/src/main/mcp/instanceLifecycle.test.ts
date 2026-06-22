import { describe, it, expect } from 'vitest'
import { decideCreateInstance, decideTerminateInstance, type InstanceView } from './instanceLifecycle'

const SELF = 1000

function inst(p: Partial<InstanceView> & { pid: number }): InstanceView {
  return { name: `i-${String(p.pid)}`, projectPath: null, mcpActive: true, ...p }
}

describe('decideCreateInstance — uniqueness against ALL instances (incl. MCP-cut)', () => {
  it('allows when no name/file collision', () => {
    const d = decideCreateInstance({
      file: '/tmp/a.restorm',
      name: 'alpha',
      selfPid: SELF,
      instances: [inst({ pid: 2000, name: 'beta', projectPath: '/tmp/b.restorm' })]
    })
    expect(d).toEqual({ ok: true, spawnFile: '/tmp/a.restorm', spawnName: 'alpha' })
  })

  it('refuses when another instance already has the NAME (even if that instance has MCP CUT)', () => {
    const d = decideCreateInstance({
      file: null,
      name: 'alpha',
      selfPid: SELF,
      instances: [inst({ pid: 2000, name: 'alpha', mcpActive: false })]
    })
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.reason).toMatch(/already exists/)
  })

  it('refuses when another instance already has the FILE open (MCP-cut counts)', () => {
    const d = decideCreateInstance({
      file: '/tmp/a.restorm',
      name: 'newname',
      selfPid: SELF,
      instances: [inst({ pid: 2000, name: 'other', projectPath: '/tmp/a.restorm', mcpActive: false })]
    })
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.reason).toMatch(/already has/)
  })

  it('excludes SELF from the collision check (re-create for the file I have open is allowed)', () => {
    const d = decideCreateInstance({
      file: '/tmp/a.restorm',
      name: 'me',
      selfPid: SELF,
      instances: [inst({ pid: SELF, name: 'me', projectPath: '/tmp/a.restorm' })]
    })
    expect(d.ok).toBe(true)
  })

  it('rejects a non-absolute file path', () => {
    const d = decideCreateInstance({ file: 'relative.restorm', name: null, selfPid: SELF, instances: [] })
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.reason).toMatch(/absolute/)
  })

  it('allows an empty instance (no file, no name)', () => {
    const d = decideCreateInstance({ file: null, name: null, selfPid: SELF, instances: [] })
    expect(d).toEqual({ ok: true, spawnFile: null, spawnName: null })
  })
})

describe('decideTerminateInstance — File→Quit semantics with the save param', () => {
  it('closes now when autosave is on (regardless of dirty)', () => {
    expect(decideTerminateInstance({ autoSaveOn: true, dirty: true, save: undefined })).toEqual({ kind: 'closeNow' })
  })

  it('closes now when nothing is dirty', () => {
    expect(decideTerminateInstance({ autoSaveOn: false, dirty: false, save: undefined })).toEqual({ kind: 'closeNow' })
  })

  it('save=true → save then close (autosave off, dirty)', () => {
    expect(decideTerminateInstance({ autoSaveOn: false, dirty: true, save: true })).toEqual({ kind: 'saveThenClose' })
  })

  it('save=false → discard then close (autosave off, dirty)', () => {
    expect(decideTerminateInstance({ autoSaveOn: false, dirty: true, save: false })).toEqual({ kind: 'discardThenClose' })
  })

  it('save omitted + autosave off + dirty → show the modal, do NOT force-close', () => {
    expect(decideTerminateInstance({ autoSaveOn: false, dirty: true, save: undefined })).toEqual({ kind: 'awaitUserConfirmation' })
  })
})
