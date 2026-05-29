import { describe, it, expect } from 'vitest'
import { isScenario, isRequest, isAnyFolder, isEnvironmentFolder } from '../../src/shared/types/collections'
import type { FolderItem, Scenario } from '../../src/shared/types/collections'

const scenario: Scenario = {
  type: 'scenario',
  id: 'scn-1',
  name: 'Login flow',
  tags: [],
  params: [],
  nodes: [],
  edges: []
}

// A minimal HTTP request shaped like the tree carries it.
const request = {
  type: 'http',
  id: 'req-1',
  name: 'Get user',
  method: 'GET',
  url: '/users/1',
  headers: [],
  params: []
} as unknown as FolderItem

const folder = {
  id: 'fld-1',
  name: 'Folder',
  tags: [],
  configuration: {},
  items: []
} as unknown as FolderItem

describe('scenario tree-item guards', () => {
  it('isScenario only matches the scenario discriminant', () => {
    expect(isScenario(scenario)).toBe(true)
    expect(isScenario(request)).toBe(false)
    expect(isScenario(folder)).toBe(false)
  })

  it('isRequest excludes scenarios (both are childless, type-bearing items)', () => {
    expect(isRequest(request)).toBe(true)
    // The regression guard: a scenario has `type` + no `items`, so the
    // naive request check used to mis-classify it. It must not.
    expect(isRequest(scenario)).toBe(false)
    expect(isRequest(folder)).toBe(false)
  })

  it('folder guards never match a scenario', () => {
    expect(isAnyFolder(scenario)).toBe(false)
    expect(isEnvironmentFolder(scenario)).toBe(false)
  })
})
