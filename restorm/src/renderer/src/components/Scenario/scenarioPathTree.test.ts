import { describe, it, expect } from 'vitest'
import { buildScenarioPathTree, isDataLink } from './scenarioPathTree'
import { isValidSelectorPath } from './scenarioValidation'
import type { ListViewItemData } from 'electron-core-ui/renderer'

/** Flatten the tree to a id→title map for terse path assertions. */
function flatten(items: ListViewItemData[], acc: Record<string, string> = {}): Record<string, string> {
  for (const it of items) {
    acc[it.id] = typeof it.title === 'string' ? it.title : ''
    if (it.children) flatten(it.children, acc)
  }
  return acc
}

describe('isDataLink', () => {
  it('is true when a value output feeds a value input', () => {
    expect(isDataLink('value', 'value')).toBe(true)
  })
  it('is true when a `both` output feeds a value input', () => {
    expect(isDataLink('value', 'both')).toBe(true)
  })
  it('is false for a pure signal output (a trigger carries no data)', () => {
    expect(isDataLink('value', 'signal')).toBe(false)
  })
  it('is false when the receiving input is the signal launch trigger', () => {
    expect(isDataLink('signal', 'both')).toBe(false)
  })
})

describe('buildScenarioPathTree', () => {
  const context = {
    nodeId: 'n1',
    requestId: 'r1',
    historyGuid: 'g1',
    timestamp: '2026-05-21T00:00:00Z',
    request: { url: 'https://api/users', method: 'GET' },
    restormRequest: { id: 'r1', url: '{{base}}/users', notes: 'raw model' },
    response: {
      status: 200,
      headers: [{ key: 'content-type', value: 'application/json' }],
      body: '{"users":[{"id":42,"name":"Ana"}],"total":1}'
    }
  }

  it('drops run-bookkeeping + raw-model root keys, keeps request/response', () => {
    const ids = Object.keys(flatten(buildScenarioPathTree(context)))
    expect(ids).toContain('request')
    expect(ids).toContain('response')
    expect(ids).not.toContain('nodeId')
    expect(ids).not.toContain('historyGuid')
    expect(ids).not.toContain('restormRequest')
  })

  it('derives dot-paths, drilling into a JSON-string body and array indices', () => {
    const map = flatten(buildScenarioPathTree(context))
    expect(map['response.status']).toBe('status: 200')
    expect(map['response.body.users.0.id']).toBe('id: 42')
    expect(map['response.body.users.0.name']).toBe('name: "Ana"')
    expect(map['response.body.total']).toBe('total: 1')
    // header value reachable by array index
    expect(map['response.headers.0.value']).toBe('value: "application/json"')
  })

  it('labels arrays with their length', () => {
    const map = flatten(buildScenarioPathTree(context))
    expect(map['response.body.users']).toBe('users [1]')
  })

  it('returns an empty tree for a null/non-object context', () => {
    expect(buildScenarioPathTree(null)).toEqual([])
    expect(buildScenarioPathTree('nope')).toEqual([])
  })

  it('emits bracket notation for keys that are not bare identifiers (root + nested)', () => {
    const map = flatten(buildScenarioPathTree({
      'Anwser to the universe': 42,
      obj: { 'full name': 'Marty' }
    }))
    expect(map["['Anwser to the universe']"]).toBe('Anwser to the universe: 42')
    expect(map["obj['full name']"]).toBe('full name: "Marty"')
  })

  it('every generated path id is a valid selector', () => {
    const map = flatten(buildScenarioPathTree({
      'a b': { c: [1, 2], 'x.y': 'z' },
      plain: 'v'
    }))
    for (const id of Object.keys(map)) {
      expect(isValidSelectorPath(id), id).toBe(true)
    }
  })
})
