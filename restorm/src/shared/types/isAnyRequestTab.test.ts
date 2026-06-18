// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { isAnyRequestTab } from './editor'
import type { RestormEditorTab } from './editor'

const asTab = (o: unknown): RestormEditorTab => o as RestormEditorTab

describe('isAnyRequestTab', () => {
  it('matches every protocol request tab', () => {
    for (const tabType of [
      'http-request', 'graphql-request', 'grpc-request', 'soap-request',
      'websocket-request', 'odata-request', 'auth-request'
    ]) {
      expect(isAnyRequestTab(asTab({ tabType, request: { id: 'r' } })), tabType).toBe(true)
    }
  })

  it('rejects non-request tabs', () => {
    for (const tabType of ['folder', 'environment-folder', 'scenario-editor', 'console', 'firewall', 'mini-browser', 'settings', 'mcp-logs']) {
      expect(isAnyRequestTab(asTab({ tabType })), tabType).toBe(false)
    }
  })

  it('rejects a tab with no tabType (legacy) and a request-ish substring that is not an exact match', () => {
    expect(isAnyRequestTab(asTab({}))).toBe(false)
    // The old `tabType.includes('request')` sniff would wrongly match this.
    expect(isAnyRequestTab(asTab({ tabType: 'request-history' }))).toBe(false)
  })
})
