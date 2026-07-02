/**
 * Unit tests for `ApiBlueprintImportService` — parses the canonical
 * `polls.apib` fixture (a trimmed version of the well-known Apiary Polls
 * sample) and asserts the shape of the generated EnvironmentFolder +
 * ApiDocumentation.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { importApiBlueprint } from '../../src/main/services/import/ApiBlueprintImportService'
import { HTTPRequest, type Folder } from '../../src/shared/models'

const fixturePath = join(__dirname, 'fixtures', 'api-blueprint', 'polls.apib')
const fixture = readFileSync(fixturePath, 'utf-8')

function expectPresent<T>(value: T | undefined | null, label: string): T {
  if (value === undefined || value === null) {
    throw new Error(`expected ${label} to be present`)
  }
  return value
}

function findFolder(items: (Folder | HTTPRequest)[], name: string): Folder {
  const folder = items.find((item): item is Folder => 'items' in item && item.name === name)
  return expectPresent(folder, `folder "${name}"`)
}

describe('importApiBlueprint', () => {
  it('returns an EnvironmentFolder with api-blueprint-tagged import origin', () => {
    const root = importApiBlueprint(fixture, { sourceUrl: 'https://example.com/polls.apib' })
    expect(root.folderType).toBe('environment')
    expect(root.importSource).toBe('api-blueprint')
    expect(root.name).toBe('Polls')
    expect(root.apiDocumentation?.sourceType).toBe('api-blueprint')
    expect(root.apiDocumentation?.sourceUrl).toBe('https://example.com/polls.apib')
  })

  it('creates a Default environment with baseUrl derived from the HOST metadata', () => {
    const root = importApiBlueprint(fixture)
    expect(root.environments).toHaveLength(1)
    const env = expectPresent(root.environments[0], 'environment[0]')
    expect(env.name).toBe('Default')
    const baseUrl = env.variables.find((v) => v.key === 'baseUrl')
    expect(baseUrl?.value.toString()).toBe('https://polls.apiblueprint.org/')
  })

  it('honours a caller-supplied baseUrl override', () => {
    const root = importApiBlueprint(fixture, { baseUrl: 'https://prod.example.com' })
    const env = expectPresent(root.environments[0], 'environment[0]')
    const baseUrl = env.variables.find((v) => v.key === 'baseUrl')
    expect(baseUrl?.value.toString()).toBe('https://prod.example.com')
  })

  it('maps the resource group to a folder holding one request per transition', () => {
    const root = importApiBlueprint(fixture)
    const questionFolder = findFolder(root.items as (Folder | HTTPRequest)[], 'Question')
    expect(questionFolder.items).toHaveLength(3)
    const names = questionFolder.items.map((r) => r.name).sort()
    expect(names).toEqual(['List All Questions', 'View a Question Detail', 'Vote on a Question'])
  })

  it('builds request method + Handlebars URL + path params from the resource href', () => {
    const root = importApiBlueprint(fixture)
    const questionFolder = findFolder(root.items as (Folder | HTTPRequest)[], 'Question')
    const vote = questionFolder.items.find((r) => r.name === 'Vote on a Question') as HTTPRequest
    expect(vote.method).toBe('POST')
    expect(vote.url).toBe('{{baseUrl}}/questions/{{question_id}}')
    expect(vote.pathParams.map((p) => p.key)).toEqual(['question_id'])
  })

  it('extracts the request body from the message body example', () => {
    const root = importApiBlueprint(fixture)
    const questionFolder = findFolder(root.items as (Folder | HTTPRequest)[], 'Question')
    const vote = questionFolder.items.find((r) => r.name === 'Vote on a Question') as HTTPRequest
    expect(vote.body?.type).toBe('text')
    expect(JSON.parse(vote.body?.content ?? '{}')).toEqual({ choice_id: 1 })
  })

  it('maps the Data Structures section to ApiDocumentation models', () => {
    const root = importApiBlueprint(fixture)
    const models = root.apiDocumentation?.models ?? {}
    expect(Object.keys(models).sort()).toEqual(['Choice', 'Question'])
    const question = expectPresent(models.Question, 'models.Question')
    const choicesProp = question.properties.find((p) => p.name === 'choices')
    expect(choicesProp?.isArrayOfRef).toBe(true)
    expect(choicesProp?.targetModelRef).toBe('Choice')
  })

  it('is idempotent: importing the same content twice yields identical ids and shape', () => {
    const first = importApiBlueprint(fixture)
    const second = importApiBlueprint(fixture)
    expect(second.id).toBe(first.id)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })
})

describe('canImport (via the provider registry)', () => {
  it('recognises .apib content and files, and rejects unrelated Markdown/YAML', async () => {
    const { importProviders } = await import('../../src/main/services/import/providers')
    const provider = expectPresent(
      importProviders.find((p) => p.format === 'api-blueprint'),
      'api-blueprint provider'
    )
    expect(provider.canImport(fixture)).toBe(true)
    expect(provider.canImport('# Just a heading\n\nSome prose.', 'notes.md')).toBe(false)
    expect(provider.canImport('openapi: 3.0.0\ninfo:\n  title: Foo', 'openapi.yaml')).toBe(false)
    expect(provider.canImport('not api blueprint at all', 'spec.apib')).toBe(true)
    expect(provider.canImport('')).toBe(false)
  })
})
