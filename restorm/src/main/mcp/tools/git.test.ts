import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { McpService, McpToolConfig, McpToolHandler } from 'electron-core-ui'

class FakeMcpService {
  private handlers = new Map<string, McpToolHandler>()
  registerTool(name: string, _config: McpToolConfig, handler: McpToolHandler): void {
    this.handlers.set(name, handler)
  }
  registerResource(): void { /* unused */ }
  async invoke(name: string, args: Record<string, unknown> = {}): Promise<{ content: { type: 'text'; text: string }[]; isError?: true }> {
    const handler = this.handlers.get(name)
    if (!handler) throw new Error(`tool "${name}" not registered`)
    return (await handler(args, {})) as { content: { type: 'text'; text: string }[]; isError?: true }
  }
}

function parse(result: { content: { type: 'text'; text: string }[] }): Record<string, unknown> {
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>
}

const gitState = {
  activeFolder: '/proj' as string | null,
  filePath: '/proj/api.restorm' as string | null,
  fileAtHead: null as string | null,
  pullResult: { success: true, conflicted: false, conflictFiles: [] } as {
    success: boolean, conflicted: boolean, conflictFiles: string[], error?: string
  },
  conflictVersions: { path: 'api.restorm', base: null, ours: null, theirs: null } as {
    path: string, base: string | null, ours: string | null, theirs: string | null
  },
  commitResult: { success: true, commit: 'sha123' } as { success: boolean, commit?: string, error?: string },
  pushResult: { success: true } as { success: boolean, error?: string },
  collections: [] as unknown[],
  settingValue: undefined as unknown
}

const stageSpy = vi.fn()
const commitSpy = vi.fn(() => gitState.commitResult)
const pushSpy = vi.fn(() => gitState.pushResult)
const writeResolvedConflictSpy = vi.fn()

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] }
}))

vi.mock('electron-core-ui', () => ({
  getGitService: () => ({
    getActiveFolder: () => gitState.activeFolder,
    getFileAtHead: () => Promise.resolve(gitState.fileAtHead),
    stage: (...args: unknown[]) => { stageSpy(...args); return Promise.resolve() },
    commit: (...args: unknown[]) => Promise.resolve(commitSpy(...args)),
    push: (...args: unknown[]) => Promise.resolve(pushSpy(...args)),
    pull: () => Promise.resolve(gitState.pullResult),
    getConflictVersions: () => Promise.resolve(gitState.conflictVersions),
    getConflictCommitTimestamps: () => Promise.resolve({ ours: null, theirs: null }),
    writeResolvedConflict: (...args: unknown[]) => { writeResolvedConflictSpy(...args); return Promise.resolve() }
  }),
  getFileService: () => ({ getFilePath: () => gitState.filePath }),
  isFileServiceInitialized: () => true,
  getSettingsService: () => ({ get: () => gitState.settingValue }),
  isSettingsServiceInitialized: () => true,
  i18nService: {
    getFixedT: (lang: string) => (key: string, params?: Record<string, unknown>) => `${lang}:${key}:${JSON.stringify(params ?? {})}`,
    t: (key: string) => key
  },
  renderCommitMessage: (
    _templates: unknown,
    context: { titleSummary: string, lines: string[] }
  ) => ({ title: context.titleSummary, body: context.lines.join('\n') })
}))

vi.mock('../../services/CollectionStore', () => ({
  collectionStore: { getCollections: () => gitState.collections }
}))

import { registerGitTools } from './git'
import { resetGitMcpStateForTests } from '../gitMcpState'

function makeRequest(id: string, name: string, extra: Record<string, unknown> = {}): unknown {
  return { id, name, type: 'http', tags: [], ...extra }
}

const HEAD_YAML = [
  '_projectUuid: proj-uuid',
  'collections:',
  '  - id: r1',
  '    name: Find pet by ID',
  '    type: http',
  '    tags: []',
  '    url: https://old.example.com'
].join('\n')

describe('git MCP tools', () => {
  let mcp: FakeMcpService

  beforeEach(() => {
    mcp = new FakeMcpService()
    registerGitTools(mcp as unknown as McpService)
    resetGitMcpStateForTests()
    gitState.activeFolder = '/proj'
    gitState.filePath = '/proj/api.restorm'
    gitState.fileAtHead = null
    gitState.pullResult = { success: true, conflicted: false, conflictFiles: [] }
    gitState.conflictVersions = { path: 'api.restorm', base: null, ours: null, theirs: null }
    gitState.commitResult = { success: true, commit: 'sha123' }
    gitState.pushResult = { success: true }
    gitState.collections = []
    gitState.settingValue = undefined
    stageSpy.mockClear()
    commitSpy.mockClear()
    pushSpy.mockClear()
    writeResolvedConflictSpy.mockClear()
  })

  describe('git_commit_push', () => {
    it('refuses when there is no open .restorm project inside a git folder', async () => {
      gitState.activeFolder = null
      const result = await mcp.invoke('git_commit_push')
      expect(result.isError).toBe(true)
    })

    it('reports no changes when the project matches the last commit', async () => {
      gitState.fileAtHead = HEAD_YAML
      gitState.collections = [makeRequest('r1', 'Find pet by ID', { url: 'https://old.example.com' })]
      const result = await mcp.invoke('git_commit_push')
      expect(parse(result)).toMatchObject({ hasChanges: false })
    })

    it('returns a reviewToken + generated title/body + before/after payloads when the project changed', async () => {
      gitState.fileAtHead = HEAD_YAML
      gitState.collections = [makeRequest('r1', 'Find pet by ID', { url: 'https://new.example.com' })]
      const result = await mcp.invoke('git_commit_push')
      const body = parse(result)
      expect(body['hasChanges']).toBe(true)
      expect(typeof body['reviewToken']).toBe('string')
      expect(body['title']).toBeTruthy()
      const changes = body['changes'] as { kind: string, name: string, action: string, before?: unknown, after?: unknown }[]
      expect(changes).toHaveLength(1)
      expect(changes[0]).toMatchObject({ kind: 'request', name: 'Find pet by ID', action: 'modified' })
      expect((changes[0]?.before as { url: string }).url).toBe('https://old.example.com')
      expect((changes[0]?.after as { url: string }).url).toBe('https://new.example.com')
    })

    it('uses the configured commitMessageLanguage setting when no override is given', async () => {
      gitState.settingValue = 'fr'
      gitState.fileAtHead = null
      gitState.collections = [makeRequest('r1', 'New request')]
      const result = await mcp.invoke('git_commit_push')
      const body = parse(result)
      // The fake i18n echoes the language into every string it produces.
      expect(body['title']).toContain('fr:')
    })

    it('an explicit language argument overrides the setting', async () => {
      gitState.settingValue = 'fr'
      gitState.fileAtHead = null
      gitState.collections = [makeRequest('r1', 'New request')]
      const result = await mcp.invoke('git_commit_push', { language: 'en' })
      const body = parse(result)
      expect(body['title']).toContain('en:')
    })
  })

  describe('git_confirm_push', () => {
    async function review(): Promise<string> {
      gitState.fileAtHead = null
      gitState.collections = [makeRequest('r1', 'New request')]
      const result = await mcp.invoke('git_commit_push')
      return parse(result)['reviewToken'] as string
    }

    it('refuses without a matching pending review', async () => {
      const result = await mcp.invoke('git_confirm_push', { reviewToken: 'bogus' })
      expect(result.isError).toBe(true)
    })

    it('refuses + clears the pending review when the project changed since the review', async () => {
      const token = await review()
      gitState.collections = [...gitState.collections, makeRequest('r2', 'Another new request')]
      const result = await mcp.invoke('git_confirm_push', { reviewToken: token })
      expect(result.isError).toBe(true)
      const second = await mcp.invoke('git_confirm_push', { reviewToken: token })
      expect(second.isError).toBe(true)
      expect(second.content[0]?.text).toContain('git_commit_push first')
    })

    it('stages, commits, and pushes on a matching token; clears the pending review', async () => {
      const token = await review()
      const result = await mcp.invoke('git_confirm_push', { reviewToken: token })
      expect(stageSpy).toHaveBeenCalledWith('/proj', ['api.restorm'])
      expect(commitSpy).toHaveBeenCalled()
      expect(pushSpy).toHaveBeenCalled()
      expect(parse(result)).toEqual({ committed: true, commit: 'sha123', pushed: true })

      const replay = await mcp.invoke('git_confirm_push', { reviewToken: token })
      expect(replay.isError).toBe(true)
    })

    it('lets the caller override the generated title/body', async () => {
      const token = await review()
      await mcp.invoke('git_confirm_push', { reviewToken: token, title: 'Custom title', body: 'Custom body' })
      expect(commitSpy).toHaveBeenCalledWith('/proj', 'Custom title\n\nCustom body')
    })

    it('reports a commit failure and clears the pending review', async () => {
      gitState.commitResult = { success: false, error: 'nothing to commit' }
      const token = await review()
      const result = await mcp.invoke('git_confirm_push', { reviewToken: token })
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toContain('nothing to commit')
      expect(pushSpy).not.toHaveBeenCalled()
    })

    it('reports a push failure after a successful commit', async () => {
      gitState.pushResult = { success: false, error: 'network down' }
      const token = await review()
      const result = await mcp.invoke('git_confirm_push', { reviewToken: token })
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toContain('network down')
      expect(result.content[0]?.text).toContain('sha123')
    })
  })

  describe('git_pull', () => {
    it('refuses when there is no open .restorm project inside a git folder', async () => {
      gitState.filePath = null
      const result = await mcp.invoke('git_pull')
      expect(result.isError).toBe(true)
    })

    it('reports a clean pull with no conflicts', async () => {
      gitState.pullResult = { success: true, conflicted: false, conflictFiles: [] }
      const result = await mcp.invoke('git_pull')
      expect(parse(result)).toEqual({ pulled: true, conflicted: false })
    })

    it('reports a non-conflict failure', async () => {
      gitState.pullResult = { success: false, conflicted: false, conflictFiles: [], error: 'network down' }
      const result = await mcp.invoke('git_pull')
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toContain('network down')
    })

    it('returns a resolutionToken + the identified conflict list on a conflicted pull', async () => {
      gitState.pullResult = { success: false, conflicted: true, conflictFiles: ['api.restorm'] }
      gitState.conflictVersions = {
        path: 'api.restorm',
        base: null,
        ours: [
          'collections:', '  - id: r1', '    name: Find pet by ID', '    type: http', '    tags: []', '    url: https://ours.example.com'
        ].join('\n'),
        theirs: [
          'collections:', '  - id: r1', '    name: Find pet by ID', '    type: http', '    tags: []', '    url: https://theirs.example.com'
        ].join('\n')
      }
      const result = await mcp.invoke('git_pull')
      const body = parse(result)
      expect(body['conflicted']).toBe(true)
      expect(typeof body['resolutionToken']).toBe('string')
      const conflicts = body['conflicts'] as { id: string, kind: string, name: string, ours: unknown, theirs: unknown }[]
      expect(conflicts).toHaveLength(1)
      expect(conflicts[0]).toMatchObject({ id: 'r1', kind: 'request', name: 'Find pet by ID' })
      expect((conflicts[0]?.ours as { url: string }).url).toBe('https://ours.example.com')
      expect((conflicts[0]?.theirs as { url: string }).url).toBe('https://theirs.example.com')
    })
  })

  describe('git_resolve_conflicts', () => {
    async function pullConflict(): Promise<string> {
      gitState.pullResult = { success: false, conflicted: true, conflictFiles: ['api.restorm'] }
      gitState.conflictVersions = {
        path: 'api.restorm',
        base: null,
        ours: [
          '_projectUuid: proj-uuid',
          'collections:', '  - id: r1', '    name: Find pet by ID', '    type: http', '    tags: []', '    url: https://ours.example.com'
        ].join('\n'),
        theirs: [
          'collections:', '  - id: r1', '    name: Find pet by ID', '    type: http', '    tags: []', '    url: https://theirs.example.com'
        ].join('\n')
      }
      const result = await mcp.invoke('git_pull')
      return parse(result)['resolutionToken'] as string
    }

    it('refuses without a matching resolutionToken', async () => {
      const result = await mcp.invoke('git_resolve_conflicts', { resolutionToken: 'bogus', resolutions: [{ id: 'r1', pick: 'ours' }] })
      expect(result.isError).toBe(true)
    })

    it('refuses when a resolution is missing for a listed conflict', async () => {
      const token = await pullConflict()
      const result = await mcp.invoke('git_resolve_conflicts', { resolutionToken: token, resolutions: [] })
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toContain('Missing a resolution')
    })

    it('refuses on an unknown conflict id', async () => {
      const token = await pullConflict()
      const result = await mcp.invoke('git_resolve_conflicts', {
        resolutionToken: token,
        resolutions: [{ id: 'r1', pick: 'ours' }, { id: 'does-not-exist', pick: 'theirs' }]
      })
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toContain('does-not-exist')
    })

    it('writes the merged tree (preserving _projectUuid), commits, and clears the pending resolution', async () => {
      const token = await pullConflict()
      const result = await mcp.invoke('git_resolve_conflicts', { resolutionToken: token, resolutions: [{ id: 'r1', pick: 'theirs' }] })
      expect(parse(result)).toEqual({ resolved: true, commit: 'sha123' })
      expect(writeResolvedConflictSpy).toHaveBeenCalledTimes(1)
      const [folder, relativePath, yamlText] = writeResolvedConflictSpy.mock.calls[0] as [string, string, string]
      expect(folder).toBe('/proj')
      expect(relativePath).toBe('api.restorm')
      expect(yamlText).toContain('https://theirs.example.com')
      expect(yamlText).toContain('_projectUuid: proj-uuid')

      const replay = await mcp.invoke('git_resolve_conflicts', { resolutionToken: token, resolutions: [{ id: 'r1', pick: 'theirs' }] })
      expect(replay.isError).toBe(true)
    })

    it('reports a commit failure without clearing the pending resolution (the write already landed)', async () => {
      gitState.commitResult = { success: false, error: 'nothing to commit' }
      const token = await pullConflict()
      const result = await mcp.invoke('git_resolve_conflicts', { resolutionToken: token, resolutions: [{ id: 'r1', pick: 'ours' }] })
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toContain('nothing to commit')
    })
  })
})
