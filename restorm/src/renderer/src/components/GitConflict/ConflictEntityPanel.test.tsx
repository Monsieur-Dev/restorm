// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'

// Every real panel component here is heavy (Monaco, React-Flow, …) and
// already unit-tested on its own — this suite only verifies the DISPATCH
// logic (right component for the right entity kind, readOnly wrapping),
// so every leaf is mocked to a simple marker.
vi.mock('electron-core-ui/renderer', () => ({
  // The name row renders one; a text input is enough for these assertions.
  InputBox: ({ value, onChange, 'data-testid': testId, options }: { value?: string, onChange?: (v: string) => void, 'data-testid'?: string, options?: { readOnly?: boolean } }) =>
    <input data-testid={testId} value={value ?? ''} readOnly={options?.readOnly ?? false} onChange={(e) => { onChange?.(e.target.value) }} />,

  CodeEditor: ({ value, options }: { value: string, options?: { readOnly?: boolean } }) => (
    <div data-testid="mock-code-editor" data-readonly={String(options?.readOnly)}>{value}</div>
  ),
  ReadOnlyOverlay: ({ children, 'data-testid': testId }: { children: React.ReactNode, 'data-testid'?: string }) => (
    <div data-testid={testId ?? 'mock-read-only-overlay'} data-role="read-only-overlay">{children}</div>
  )
}))
vi.mock('../../contexts/EnvironmentContext', () => ({
  EnvironmentProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))
vi.mock('../Folders/FolderView', () => ({
  FolderView: ({ folder }: { folder: { name: string } }) => <div data-testid="mock-folder-view">{folder.name}</div>
}))
vi.mock('../Folders/EnvironmentFolderView', () => ({
  EnvironmentFolderView: ({ folder }: { folder: { name: string } }) => <div data-testid="mock-env-folder-view">{folder.name}</div>
}))
vi.mock('../Scenario/ScenarioEditorView', () => ({
  ScenarioEditorView: ({ scenario, onScenarioChange, resolveBoundItem }: { scenario: { name: string }, onScenarioChange?: unknown, resolveBoundItem?: unknown }) => (
    <div
      data-testid="mock-scenario-view"
      data-has-onchange={onScenarioChange ? 'true' : 'false'}
      data-has-resolver={resolveBoundItem ? 'true' : 'false'}
    >{scenario.name}</div>
  )
}))
/** Every protocol's conflict-mode mock is shaped identically — a marker
 * div reporting the same 4 conflict props (`conflictFieldDiff`/
 * `defaultActiveTabId`/`showCodeSnippets`/`conflictMode`) — so a single
 * factory covers all 6 real-panel mocks below. */
function makeMockTabView(testId: string): React.FC<{
  request: { name: string }, conflictFieldDiff?: unknown, defaultActiveTabId?: string, showCodeSnippets?: boolean, conflictMode?: boolean
}> {
  const MockTabView: React.FC<{
    request: { name: string }, conflictFieldDiff?: unknown, defaultActiveTabId?: string, showCodeSnippets?: boolean, conflictMode?: boolean
  }> = ({ request, conflictFieldDiff, defaultActiveTabId, showCodeSnippets, conflictMode }) => (
    <div
      data-testid={testId}
      data-has-field-diff={conflictFieldDiff ? 'true' : 'false'}
      data-default-active-tab-id={defaultActiveTabId ?? ''}
      data-show-code-snippets={String(showCodeSnippets)}
      data-conflict-mode={String(conflictMode)}
    >
      {request.name}
    </div>
  )
  MockTabView.displayName = `MockTabView(${testId})`
  return MockTabView
}
vi.mock('../RequestTabViews/HTTPRequestTabView', () => ({ HTTPRequestTabView: makeMockTabView('mock-http-view') }))
vi.mock('../RequestTabViews/GraphQLRequestTabView', () => ({ GraphQLRequestTabView: makeMockTabView('mock-graphql-view') }))
vi.mock('../RequestTabViews/GrpcRequestTabView', () => ({ GrpcRequestTabView: makeMockTabView('mock-grpc-view') }))
vi.mock('../RequestTabViews/WebSocketRequestTabView', () => ({ WebSocketRequestTabView: makeMockTabView('mock-websocket-view') }))
vi.mock('../RequestTabViews/ODataRequestTabView', () => ({ ODataRequestTabView: makeMockTabView('mock-odata-view') }))
vi.mock('../RequestTabViews/SoapRequestTabView', () => ({ SoapRequestTabView: makeMockTabView('mock-soap-view') }))
vi.mock('../RequestTabViews/SoapServerRequestTabView', () => ({
  SoapServerRequestTabView: ({ request, conflictMode }: { request: { name: string }, conflictMode?: boolean }) => (
    <div data-testid="mock-soap-server-view" data-conflict-mode={String(conflictMode)}>{request.name}</div>
  )
}))

import { ConflictEntityPanel } from './ConflictEntityPanel'
import type { FolderItem } from '../../../../shared/types/folderTypes'

afterEach(() => { cleanup() })

function makeFolder(): FolderItem {
  return { id: 'f1', name: 'My Folder', tags: [], configuration: {}, items: [] } as unknown as FolderItem
}
function makeEnvFolder(): FolderItem {
  return { id: 'e1', name: 'My Project', tags: [], configuration: {}, folderType: 'environment', environments: [], items: [] } as unknown as FolderItem
}
function makeScenario(): FolderItem {
  return { id: 's1', name: 'Flow', type: 'scenario', tags: [], params: [], nodes: [], edges: [] } as unknown as FolderItem
}
function makeHTTPRequest(): FolderItem {
  return { id: 'r1', name: 'Find pet', type: 'http', tags: [] } as unknown as FolderItem
}
function makeGraphQLRequest(): FolderItem {
  return { id: 'r2', name: 'Get pets', type: 'graphql', tags: [] } as unknown as FolderItem
}
function makeGrpcRequest(): FolderItem {
  return { id: 'r3', name: 'Say hello', type: 'grpc', tags: [] } as unknown as FolderItem
}
function makeWebSocketRequest(): FolderItem {
  return { id: 'r4', name: 'Live feed', type: 'websocket', tags: [] } as unknown as FolderItem
}
function makeODataRequest(): FolderItem {
  return { id: 'r5', name: 'People', type: 'odata', tags: [] } as unknown as FolderItem
}
function makeSoapRequest(overrides: { server?: boolean } = {}): FolderItem {
  return { id: 'r6', name: 'GetWeather', type: 'soap', tags: [], ...overrides } as unknown as FolderItem
}
function makeUnknownEntity(): FolderItem {
  return { id: 'u1', name: 'Mystery', type: 'not-a-real-type' } as unknown as FolderItem
}

describe('ConflictEntityPanel', () => {
  it('dispatches a folder to FolderView', () => {
    render(<ConflictEntityPanel entity={makeFolder()} mode="editable" />)
    expect(screen.getByTestId('mock-folder-view').textContent).toBe('My Folder')
  })

  it('dispatches an environment folder to EnvironmentFolderView', () => {
    render(<ConflictEntityPanel entity={makeEnvFolder()} mode="editable" />)
    expect(screen.getByTestId('mock-env-folder-view').textContent).toBe('My Project')
  })

  it('dispatches a scenario to ScenarioEditorView, per Yoann: graphs render in all 3 panels with NO conflict highlighting', () => {
    render(<ConflictEntityPanel entity={makeScenario()} mode="editable" />)
    expect(screen.getByTestId('mock-scenario-view').textContent).toBe('Flow')
  })

  it('wires onScenarioChange only when editable', () => {
    const onScenarioChange = vi.fn()
    const { rerender } = render(<ConflictEntityPanel entity={makeScenario()} mode="editable" onScenarioChange={onScenarioChange} />)
    expect(screen.getByTestId('mock-scenario-view').getAttribute('data-has-onchange')).toBe('true')

    rerender(<ConflictEntityPanel entity={makeScenario()} mode="readOnly" onScenarioChange={onScenarioChange} />)
    expect(screen.getByTestId('mock-scenario-view').getAttribute('data-has-onchange')).toBe('false')
  })

  it('dispatches an HTTP request to HTTPRequestTabView, always hiding Code Snippets (AC#5)', () => {
    render(<ConflictEntityPanel entity={makeHTTPRequest()} mode="editable" />)
    const view = screen.getByTestId('mock-http-view')
    expect(view.textContent).toBe('Find pet')
    expect(view.getAttribute('data-show-code-snippets')).toBe('false')
  })

  it('passes conflictFieldDiff to HTTPRequestTabView only in readOnly mode, but defaultActiveTabId in both', () => {
    const fieldDiff = { fields: { url: true, method: false, headers: false, params: false, pathParams: false, body: false, notes: false }, preselectTabId: 'request' }
    const { rerender } = render(<ConflictEntityPanel entity={makeHTTPRequest()} mode="readOnly" fieldDiff={fieldDiff} />)
    let view = screen.getByTestId('mock-http-view')
    expect(view.getAttribute('data-has-field-diff')).toBe('true')
    expect(view.getAttribute('data-default-active-tab-id')).toBe('request')

    rerender(<ConflictEntityPanel entity={makeHTTPRequest()} mode="editable" fieldDiff={fieldDiff} />)
    view = screen.getByTestId('mock-http-view')
    expect(view.getAttribute('data-has-field-diff')).toBe('false')
    expect(view.getAttribute('data-default-active-tab-id')).toBe('request')
  })

  it.each([
    ['graphql', makeGraphQLRequest, 'mock-graphql-view', 'Get pets'],
    ['grpc', makeGrpcRequest, 'mock-grpc-view', 'Say hello'],
    ['websocket', makeWebSocketRequest, 'mock-websocket-view', 'Live feed'],
    ['odata', makeODataRequest, 'mock-odata-view', 'People']
  ] as const)('dispatches a %s request to its real conflict-mode panel, always hiding Code Snippets and forcing conflictMode', (_type, make, testId, name) => {
    render(<ConflictEntityPanel entity={make()} mode="editable" />)
    const view = screen.getByTestId(testId)
    expect(view.textContent).toBe(name)
    expect(view.getAttribute('data-show-code-snippets')).toBe('false')
    expect(view.getAttribute('data-conflict-mode')).toBe('true')
  })

  it('dispatches a client-mode SOAP request to SoapRequestTabView', () => {
    render(<ConflictEntityPanel entity={makeSoapRequest()} mode="editable" />)
    expect(screen.getByTestId('mock-soap-view').textContent).toBe('GetWeather')
    expect(screen.queryByTestId('mock-soap-server-view')).toBeNull()
  })

  it('dispatches a server-mode SOAP request to SoapServerRequestTabView (mirrors RestormWorkbench\'s branch), forcing conflictMode', () => {
    render(<ConflictEntityPanel entity={makeSoapRequest({ server: true })} mode="editable" />)
    const view = screen.getByTestId('mock-soap-server-view')
    expect(view.textContent).toBe('GetWeather')
    expect(view.getAttribute('data-conflict-mode')).toBe('true')
    expect(screen.queryByTestId('mock-soap-view')).toBeNull()
  })

  it('falls back to the Monaco 3-pane view for a request-shaped entity with an unrecognized type (defensive runtime fallback)', () => {
    render(<ConflictEntityPanel entity={makeUnknownEntity()} mode="editable" />)
    expect(screen.getByTestId('mock-code-editor')).toBeTruthy()
    expect(screen.getByTestId('mock-code-editor').textContent).toContain('Mystery')
  })

  it('keeps the Monaco fallback read-only in BOTH modes (no structured writer to feed free-form edits back), with a pick-a-side notice only in the editable pane', () => {
    // Editable (resolved) pane: read-only editor + the notice explaining that
    // only whole-entity pick-ours/theirs applies to this entity kind.
    const { rerender } = render(<ConflictEntityPanel entity={makeUnknownEntity()} mode="editable" />)
    expect(screen.getByTestId('mock-code-editor').getAttribute('data-readonly')).toBe('true')
    expect(screen.getByTestId('conflict-monaco-fallback-notice')).toBeTruthy()

    // Read-only (user/server) pane: read-only editor, no notice.
    rerender(<ConflictEntityPanel entity={makeUnknownEntity()} mode="readOnly" />)
    expect(screen.getByTestId('mock-code-editor').getAttribute('data-readonly')).toBe('true')
    expect(screen.queryByTestId('conflict-monaco-fallback-notice')).toBeNull()
  })

  it('wraps the panel in ReadOnlyOverlay when mode is readOnly, and does not when editable', () => {
    // The overlay wraps the entity view inside the panel, not the panel
    // itself — the name row above it stays outside its reach.
    const { rerender, container } = render(<ConflictEntityPanel entity={makeFolder()} mode="readOnly" data-testid="panel" />)
    expect(screen.getByTestId('panel').querySelector('[data-role="read-only-overlay"]')).toBeTruthy()

    rerender(<ConflictEntityPanel entity={makeFolder()} mode="editable" data-testid="panel" />)
    expect(container.querySelector('[data-role="read-only-overlay"]')).toBeNull()
  })
})

describe('the name row', () => {
  it('appears only when the name is what differs', () => {
    const entity = { id: 'r1', name: 'Mine', type: 'http', tags: [] } as unknown as FolderItem

    const { queryByTestId, rerender } = render(
      <ConflictEntityPanel entity={entity} mode="readOnly" fieldDiff={{ fields: { notes: true } }} />
    )
    // Nothing renamed → no row, so the panel is not padded with fields the
    // user never touched.
    expect(queryByTestId('conflict-entity-name-row')).toBeNull()

    rerender(
      <ConflictEntityPanel entity={entity} mode="readOnly" fieldDiff={{ fields: { name: true } }} />
    )
    expect(queryByTestId('conflict-entity-name-row')).toBeTruthy()
  })

  it('is read-only on a comparison column and editable on the resolved one', () => {
    const entity = { id: 'r1', name: 'Mine', type: 'http', tags: [] } as unknown as FolderItem
    const onNameChange = vi.fn()

    const { getByTestId, rerender } = render(
      <ConflictEntityPanel entity={entity} mode="readOnly" fieldDiff={{ fields: { name: true } }} />
    )
    expect(getByTestId('conflict-entity-name-input')).toBeTruthy()

    rerender(
      <ConflictEntityPanel
        entity={entity}
        mode="editable"
        fieldDiff={{ fields: { name: true } }}
        onNameChange={onNameChange}
      />
    )
    // The resolved column lets the user settle on a third name, not only
    // pick one of the two sides.
    expect(getByTestId('conflict-entity-name-input')).toBeTruthy()
  })
})

describe('showing only what conflicts', () => {
  it('drops the entity view entirely when the rename is the whole conflict', () => {
    const entity = { id: 'r1', name: 'Mine', type: 'http', tags: [] } as unknown as FolderItem
    const { queryByTestId, rerender } = render(
      <ConflictEntityPanel entity={entity} mode="readOnly" fieldDiff={{ fields: { name: true } }} />
    )
    // Only the name row survives: a full request editor under a one-line
    // difference is noise the user has to rule out tab by tab.
    expect(queryByTestId('conflict-entity-name-row')).toBeTruthy()
    expect(queryByTestId('mock-http-view')).toBeNull()

    rerender(
      <ConflictEntityPanel entity={entity} mode="readOnly" fieldDiff={{ fields: { name: true, url: true } }} />
    )
    expect(queryByTestId('mock-http-view')).toBeTruthy()
  })

  it('still renders a scenario, which has no field diff by design', () => {
    const scenario = { id: 's1', name: 'Flow', type: 'scenario', tags: [], params: [], nodes: [], edges: [] } as unknown as FolderItem
    const { queryByTestId } = render(<ConflictEntityPanel entity={scenario} mode="readOnly" />)
    expect(queryByTestId('mock-scenario-view')).toBeTruthy()
  })
})

describe('a scenario node bound to a request', () => {
  it('receives the resolver as a prop, so the node can resolve its target', () => {
    // The editor publishes this context itself from its own prop. Wrapping
    // it in an outer provider therefore has no effect — the inner one wins
    // with `null`, the node reports its request as missing, and renders an
    // error box with none of the content the conflict view exists to show.
    const resolveBoundItem = vi.fn().mockReturnValue(null)
    const scenario = { id: 's1', name: 'Flow', type: 'scenario', tags: [], params: [], nodes: [], edges: [] } as unknown as FolderItem

    render(<ConflictEntityPanel entity={scenario} mode="readOnly" resolveBoundItem={resolveBoundItem} />)

    expect(screen.getByTestId('mock-scenario-view').getAttribute('data-has-resolver')).toBe('true')
  })
})

describe('a folder conflict is never blanked by the tab filter', () => {
  it('still renders an environment folder whose diff reports no request tab', () => {
    // The folder diff only reports `notes`, so a conflict on environment
    // variables produces an empty tab list. Applying the request-only
    // "nothing to show" rule here blanked all three columns and left the
    // user unable to arbitrate what they were asked to arbitrate.
    const envFolder = {
      id: 'e1', name: 'Lab', tags: [], configuration: {}, folderType: 'environment',
      environments: [{ id: 'env1', name: 'dev', variables: [] }], items: []
    } as unknown as FolderItem

    render(<ConflictEntityPanel entity={envFolder} mode="readOnly" fieldDiff={{ fields: { notes: false } }} />)

    expect(screen.getByTestId('mock-env-folder-view')).toBeTruthy()
  })

  it('still renders a plain folder in the same situation', () => {
    const folder = { id: 'f1', name: 'Folder', tags: [], configuration: {}, items: [] } as unknown as FolderItem

    render(<ConflictEntityPanel entity={folder} mode="readOnly" fieldDiff={{ fields: { notes: false } }} />)

    expect(screen.getByTestId('mock-folder-view')).toBeTruthy()
  })
})
