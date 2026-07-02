import { describe, it, expect, vi } from 'vitest'

// The hook imports runtime values from `electron-core-ui/renderer` whose
// barrel pulls in CSS/effects the vitest transform can't resolve. We only
// test the pure `resolveRebuildTabId` mapping here, so stub the barrel
// (the serialize / apply orchestration is covered by ECUI's
// `useMcpWorkbenchLayoutBridge` + `Workbench/layout.test.ts`, where the
// real runtime is available).
vi.mock('electron-core-ui/renderer', () => ({
  useMcpWorkbenchLayoutBridge: vi.fn()
}))

import { resolveRebuildTabId } from './useMcpWorkbenchLayout'
import { CONSOLE_TAB_ID, FIREWALL_TAB_ID, MINI_BROWSER_TAB_ID, SETTINGS_TAB_ID } from '../../../shared/types/editor'

describe('resolveRebuildTabId', () => {
  it('maps singleton specials to their stable ids by tabType', () => {
    expect(resolveRebuildTabId({ id: 'x', tabType: 'console', title: '', itemId: null })).toBe(CONSOLE_TAB_ID)
    expect(resolveRebuildTabId({ id: 'x', tabType: 'firewall', title: '', itemId: null })).toBe(FIREWALL_TAB_ID)
    expect(resolveRebuildTabId({ id: 'x', tabType: 'mini-browser', title: '', itemId: null })).toBe(MINI_BROWSER_TAB_ID)
    expect(resolveRebuildTabId({ id: 'x', tabType: 'settings', title: '', itemId: null })).toBe(SETTINGS_TAB_ID)
  })

  it('maps tree-backed tabs to the legacy <type>-id:<itemId> form', () => {
    expect(resolveRebuildTabId({ id: 'x', tabType: 'folder', title: '', itemId: 'f1' })).toBe('folder-id:f1')
    expect(resolveRebuildTabId({ id: 'x', tabType: 'environment-folder', title: '', itemId: 'e1' })).toBe('env-folder-id:e1')
    expect(resolveRebuildTabId({ id: 'x', tabType: 'scenario-editor', title: '', itemId: 's1' })).toBe('scenario-id:s1')
    expect(resolveRebuildTabId({ id: 'x', tabType: 'http-request', title: '', itemId: 'r1' })).toBe('request-id:r1')
    expect(resolveRebuildTabId({ id: 'x', tabType: 'graphql-request', title: '', itemId: 'r2' })).toBe('request-id:r2')
    expect(resolveRebuildTabId({ id: 'x', tabType: 'grpc-request', title: '', itemId: 'r3' })).toBe('request-id:r3')
    expect(resolveRebuildTabId({ id: 'x', tabType: 'soap-request', title: '', itemId: 'r4' })).toBe('request-id:r4')
    expect(resolveRebuildTabId({ id: 'x', tabType: 'websocket-request', title: '', itemId: 'r5' })).toBe('request-id:r5')
    expect(resolveRebuildTabId({ id: 'x', tabType: 'sse-request', title: '', itemId: 'r8' })).toBe('request-id:r8')
    expect(resolveRebuildTabId({ id: 'x', tabType: 'odata-request', title: '', itemId: 'r6' })).toBe('request-id:r6')
    expect(resolveRebuildTabId({ id: 'x', tabType: 'auth-request', title: '', itemId: 'r7' })).toBe('request-id:r7')
  })

  it('returns null when a tree tab has no itemId or an unknown tabType', () => {
    expect(resolveRebuildTabId({ id: 'x', tabType: 'http-request', title: '', itemId: null })).toBeNull()
    expect(resolveRebuildTabId({ id: 'x', tabType: 'mystery', title: '', itemId: 'r1' })).toBeNull()
    expect(resolveRebuildTabId({ id: 'x', title: '', itemId: 'r1' })).toBeNull()
  })
})
