// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

// The real `electron-core-ui/renderer` barrel pulls in CSS/effects the
// vitest transform can't resolve; stub the two structural node guards
// the util imports (mirrors workbenchTabs.test.ts).
vi.mock('electron-core-ui/renderer', () => ({
  isContainerNode: (node: object) => 'groups' in node,
  isTabGroupNode: (node: object) => 'tabs' in node
}))

import { tabReferencesItem } from './workbenchTabs'

const asTab = (o: unknown): Parameters<typeof tabReferencesItem>[0] =>
  o as Parameters<typeof tabReferencesItem>[0]

describe('tabReferencesItem', () => {
  it('matches an http-request tab by request id', () => {
    expect(tabReferencesItem(asTab({ tabType: 'http-request', request: { id: 'r1' } }), 'r1')).toBe(true)
  })

  it('matches a non-HTTP request tab (odata/grpc/…) by request id', () => {
    expect(tabReferencesItem(asTab({ tabType: 'odata-request', request: { id: 'od1' } }), 'od1')).toBe(true)
  })

  it('matches a scenario-editor tab by scenario id (the old check missed this)', () => {
    expect(tabReferencesItem(asTab({ tabType: 'scenario-editor', scenario: { id: 's1' } }), 's1')).toBe(true)
  })

  it('matches (env-)folder tabs by folder id', () => {
    expect(tabReferencesItem(asTab({ tabType: 'folder', folder: { id: 'f1' } }), 'f1')).toBe(true)
    expect(tabReferencesItem(asTab({ tabType: 'environment-folder', folder: { id: 'e1' } }), 'e1')).toBe(true)
  })

  it('matches a tab whose breadcrumb trail includes the deleted item', () => {
    expect(tabReferencesItem(asTab({ tabType: 'http-request', request: { id: 'child' }, breadcrumbs: [{ id: 'parent' }] }), 'parent')).toBe(true)
  })

  it('does not match an unrelated tab', () => {
    expect(tabReferencesItem(asTab({ tabType: 'http-request', request: { id: 'r1' } }), 'other')).toBe(false)
  })
})
