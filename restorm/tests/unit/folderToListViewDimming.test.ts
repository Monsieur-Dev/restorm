/**
 * Tests for the deprecated-dim wrapper applied by
 * `folderItemToListViewItem` when the request id is in the
 * `deprecatedRequestIds` set. Both the title and the method badge
 * get wrapped in an `opacity: 0.5` span — wrapping just the title
 * would read as "something's wrong with the badge" rather than
 * "this whole route is deprecated".
 *
 * Companion test: the `removed: true` flag still triggers the
 * `renderRemovedTitle` strikethrough — that path is independent of
 * the live deprecation dim, since `removed` is a persisted
 * marker (the spec lost the operation entirely).
 */

import React from 'react'
import { describe, it, expect, vi } from 'vitest'

// Stub out the renderer barrel so the test loader doesn't try to
// resolve `jsoncrack-react` (lazy-loaded at runtime by the real
// barrel; the bundler can't follow it under jsdom). We only need
// the type + a placeholder for `IconView`.
vi.mock('electron-core-ui/renderer', () => ({
  IconView: () => null
}))

import { folderItemToListViewItem } from '../../src/renderer/src/services/FolderToListView'
import type { Request } from '../../src/shared/types/collections'

function makeHttpRequest(overrides: Partial<{ id: string; name: string; deprecated: boolean; removed: boolean }> = {}): Request {
  return {
    id: overrides.id ?? 'r-1',
    type: 'http',
    name: overrides.name ?? 'Find pet by ID',
    method: 'GET',
    url: '{{baseUrl}}/pet/{petId}',
    headers: [],
    params: [],
    pathParams: [],
    documentation: '',
    notes: '',
    tags: [],
    ...(overrides.deprecated === true ? { deprecated: true } : {}),
    ...(overrides.removed === true ? { removed: true } : {})
  } as unknown as Request
}

const baseOptions = {
  expandedIds: new Set<string>(),
  renderMethodBadge: vi.fn((method: string) => React.createElement('span', { 'data-testid': 'badge' }, method))
}

describe('folderItemToListViewItem — deprecated dim', () => {
  it('renders title + icon without wrapping when the request is not in the deprecated set', () => {
    const req = makeHttpRequest({ id: 'r-ok' })
    const item = folderItemToListViewItem(req, { ...baseOptions })
    expect(item.title).toBe(req.name)
    // Icon goes through whatever `renderMethodBadge` returned — no
    // dim wrapper layered on top.
    expect(React.isValidElement(item.icon)).toBe(true)
    if (React.isValidElement(item.icon)) {
      const props = item.icon.props as { 'data-testid'?: string; style?: React.CSSProperties }
      expect(props['data-testid']).toBe('badge')
      expect(props.style?.opacity).toBeUndefined()
    }
  })

  it('wraps both title and icon in `opacity: 0.5` spans when the id is in the deprecated set', () => {
    const req = makeHttpRequest({ id: 'r-deprec' })
    const deprecatedRequestIds = new Set(['r-deprec'])
    const item = folderItemToListViewItem(req, { ...baseOptions, deprecatedRequestIds })

    expect(React.isValidElement(item.title)).toBe(true)
    if (React.isValidElement(item.title)) {
      const props = item.title.props as { style?: React.CSSProperties; title?: string }
      expect(props.style?.opacity).toBe(0.5)
      expect(props.title).toContain('Deprecated')
    }
    expect(React.isValidElement(item.icon)).toBe(true)
    if (React.isValidElement(item.icon)) {
      const props = item.icon.props as { style?: React.CSSProperties }
      expect(props.style?.opacity).toBe(0.5)
    }
  })

  it('leaves other rows untouched when only one id is in the set', () => {
    const dimmed = makeHttpRequest({ id: 'r-deprec' })
    const ok = makeHttpRequest({ id: 'r-ok' })
    const set = new Set(['r-deprec'])
    const dimmedItem = folderItemToListViewItem(dimmed, { ...baseOptions, deprecatedRequestIds: set })
    const okItem = folderItemToListViewItem(ok, { ...baseOptions, deprecatedRequestIds: set })

    if (React.isValidElement(dimmedItem.title)) {
      const props = dimmedItem.title.props as { style?: React.CSSProperties }
      expect(props.style?.opacity).toBe(0.5)
    }
    expect(okItem.title).toBe(ok.name)
  })

  it('still applies the `removed` strikethrough independently of the dim set', () => {
    const removedNode = (name: string): React.ReactNode => React.createElement('span', { 'data-testid': 'removed' }, name)
    const req = makeHttpRequest({ id: 'r-gone', removed: true })
    const item = folderItemToListViewItem(req, {
      ...baseOptions,
      renderRemovedTitle: removedNode
    })
    expect(React.isValidElement(item.title)).toBe(true)
    if (React.isValidElement(item.title)) {
      const props = item.title.props as { 'data-testid'?: string }
      expect(props['data-testid']).toBe('removed')
    }
  })

  it('combines `removed` + dim when both flags apply', () => {
    const removedNode = (name: string): React.ReactNode => React.createElement('span', { 'data-testid': 'removed' }, name)
    const req = makeHttpRequest({ id: 'r-both', removed: true })
    const item = folderItemToListViewItem(req, {
      ...baseOptions,
      renderRemovedTitle: removedNode,
      deprecatedRequestIds: new Set(['r-both'])
    })
    // The dim wraps the strikethrough — outer span has opacity, inner
    // has the `data-testid="removed"` marker. The user sees a faded
    // strikethrough name.
    expect(React.isValidElement(item.title)).toBe(true)
    if (React.isValidElement(item.title)) {
      const outerProps = item.title.props as { style?: React.CSSProperties; children?: unknown }
      expect(outerProps.style?.opacity).toBe(0.5)
      const child = outerProps.children
      expect(React.isValidElement(child)).toBe(true)
      if (React.isValidElement(child)) {
        const inner = child.props as { 'data-testid'?: string }
        expect(inner['data-testid']).toBe('removed')
      }
    }
  })
})
