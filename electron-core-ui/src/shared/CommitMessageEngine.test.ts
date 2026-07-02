import { describe, it, expect } from 'vitest'
import { renderCommitMessage } from './CommitMessageEngine'

describe('renderCommitMessage', () => {
  it('renders the title and body from the given templates + context', () => {
    const result = renderCommitMessage(
      { title: '{{titleSummary}}', body: '{{#each lines}}{{this}}\n{{/each}}' },
      { titleSummary: 'Update to the request "Find pet by ID"', lines: ['Modified the request "Find pet by ID"'] }
    )
    expect(result.title).toBe('Update to the request "Find pet by ID"')
    expect(result.body).toBe('Modified the request "Find pet by ID"\n')
  })

  it('does not HTML-escape context values (noEscape) — commit messages are plain text', () => {
    const result = renderCommitMessage(
      { title: '{{name}}', body: '' },
      { name: 'Find pet by ID & friends <v2>' }
    )
    expect(result.title).toBe('Find pet by ID & friends <v2>')
  })

  it('is generic — no built-in knowledge of entity types, just whatever context it is given', () => {
    const result = renderCommitMessage(
      { title: '{{count}} widgets', body: '{{#each widgets}}- {{this}}\n{{/each}}' },
      { count: 2, widgets: ['a', 'b'] }
    )
    expect(result.title).toBe('2 widgets')
    expect(result.body).toBe('- a\n- b\n')
  })

  it('re-rendering the same template string with different context reuses the compiled template', () => {
    const templates = { title: 'Hello {{name}}', body: '' }
    expect(renderCommitMessage(templates, { name: 'A' }).title).toBe('Hello A')
    expect(renderCommitMessage(templates, { name: 'B' }).title).toBe('Hello B')
  })
})
