import { describe, it, expect } from 'vitest'
import type { TFunction } from 'i18next'
import { buildCommitMessageContext } from './commitMessageContext'
import type { GitEntityChange } from './gitCommitDiff'

// A minimal fake translator that mimics i18next's `t(key, { count, ... })`
// plural-suffix + interpolation behavior, just enough to exercise
// `buildCommitMessageContext` without loading the real i18n bundle.
const STRINGS: Record<string, string> = {
  'git.diff.addedRequest': 'Added the request "{{name}}"',
  'git.diff.modifiedRequest': 'Modified the request "{{name}}"',
  'git.diff.deletedRequest': 'Deleted the request "{{name}}"',
  'git.diff.addedScenario': 'Added the scenario "{{name}}"',
  'git.diff.modifiedFolder': 'Modified the folder "{{name}}"',
  'git.commitTitle.singleRequest': 'Update to the request "{{name}}"',
  'git.commitTitle.singleScenario': 'Update to the scenario "{{name}}"',
  'git.commitTitle.countRequest_one': '{{count}} request',
  'git.commitTitle.countRequest_other': '{{count}} requests',
  'git.commitTitle.countScenario_one': '{{count}} scenario',
  'git.commitTitle.countScenario_other': '{{count}} scenarios',
  'git.commitTitle.countFolder_one': '{{count}} folder',
  'git.commitTitle.countFolder_other': '{{count}} folders',
  'git.commitTitle.multiple': 'Update to {{parts}}'
}

function fakeTImpl(key: string, options?: Record<string, unknown>): string {
  const count = options?.['count']
  const hasCount = typeof count === 'number'
  const suffixedKey = hasCount ? `${key}_${count === 1 ? 'one' : 'other'}` : key
  const template = STRINGS[suffixedKey] ?? STRINGS[key]
  if (!template) throw new Error(`missing fake translation for ${key}`)
  return template.replace(/\{\{(\w+)\}\}/g, (_, token: string) => {
    const value = options?.[token]
    return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  })
}

const fakeT = fakeTImpl as unknown as TFunction

describe('buildCommitMessageContext', () => {
  it('returns an empty title and no lines when there are no changes', () => {
    expect(buildCommitMessageContext([], fakeT)).toEqual({ titleSummary: '', lines: [] })
  })

  it('single change: title is the natural "Update to the X" sentence for that entity', () => {
    const changes: GitEntityChange[] = [{ kind: 'request', name: 'Find pet by ID', action: 'modified' }]
    const result = buildCommitMessageContext(changes, fakeT)
    expect(result.titleSummary).toBe('Update to the request "Find pet by ID"')
    expect(result.lines).toEqual(['Modified the request "Find pet by ID"'])
  })

  it('single change: detail line reflects the real action (added), independent of the title\'s generic "Update to" framing', () => {
    const changes: GitEntityChange[] = [{ kind: 'request', name: 'New request', action: 'added' }]
    const result = buildCommitMessageContext(changes, fakeT)
    expect(result.titleSummary).toBe('Update to the request "New request"')
    expect(result.lines).toEqual(['Added the request "New request"'])
  })

  it('multiple changes: title aggregates counts per kind, folders before requests before scenarios', () => {
    const changes: GitEntityChange[] = [
      { kind: 'request', name: 'A', action: 'modified' },
      { kind: 'request', name: 'B', action: 'added' },
      { kind: 'request', name: 'C', action: 'deleted' },
      { kind: 'scenario', name: 'Checkout', action: 'added' },
      { kind: 'folder', name: 'Root', action: 'modified' }
    ]
    const result = buildCommitMessageContext(changes, fakeT)
    expect(result.titleSummary).toBe('Update to 1 folder, 3 requests, 1 scenario')
    expect(result.lines).toEqual([
      'Modified the request "A"',
      'Added the request "B"',
      'Deleted the request "C"',
      'Added the scenario "Checkout"',
      'Modified the folder "Root"'
    ])
  })

  it('multiple changes of the SAME kind use the plural count form', () => {
    const changes: GitEntityChange[] = [
      { kind: 'scenario', name: 'A', action: 'added' },
      { kind: 'scenario', name: 'B', action: 'added' }
    ]
    const result = buildCommitMessageContext(changes, fakeT)
    expect(result.titleSummary).toBe('Update to 2 scenarios')
  })
})
