// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'

import { buildMergedProjectYaml } from './mergedProjectYaml'

describe('the tree-structure pick', () => {
  const BASE = [
    'collections:',
    '  - id: f1',
    '    name: Folder A',
    '    tags: []',
    '    configuration: {}',
    '    items:',
    '      - id: r1',
    '        name: Find pet',
    '        type: http',
    '        tags: []',
    '        url: https://example.com',
    '  - id: f2',
    '    name: Folder B',
    '    tags: []',
    '    configuration: {}',
    '    items: []'
  ].join('\n')
  const MOVED_TO_B = BASE
    .replace('    items:\n      - id: r1\n        name: Find pet\n        type: http\n        tags: []\n        url: https://example.com', '    items: []')
    .replace('  - id: f2\n    name: Folder B\n    tags: []\n    configuration: {}\n    items: []',
      '  - id: f2\n    name: Folder B\n    tags: []\n    configuration: {}\n    items:\n      - id: r1\n        name: Find pet\n        type: http\n        tags: []\n        url: https://example.com')

  it('selects which side\'s hierarchy the merge walks, and is not treated as an entity', () => {
    // The entry arbitrates WHERE things live. Left in the entity picks it
    // would be looked up as an item id and silently do nothing.
    const yaml = buildMergedProjectYaml(
      { path: 'p.restorm', base: BASE, ours: BASE, theirs: MOVED_TO_B },
      { '__tree-structure__': { id: '__tree-structure__', name: 'Tree', tags: [], configuration: {}, items: [] } } as never
    )

    // Nothing named after the entry leaks into the written document.
    expect(yaml).not.toContain('__tree-structure__')
  })
})
