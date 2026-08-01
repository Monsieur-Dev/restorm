import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { EnvironmentFolder } from '../../../../shared/types/collections'

/**
 * The Home tab's API description is the same string the Docs tab renders. It
 * used to go into a plain text node, so an OpenAPI description written in
 * markdown showed its source — `Swagger at [https://swagger.io](https://swagger.io)`
 * literally, link syntax and all — while the Docs tab rendered a link from the
 * identical string.
 */

vi.mock('react-i18next', () => ({
  useTranslation: (): { t: (key: string) => string } => ({ t: (key: string) => key })
}))

vi.mock('electron-core-ui/renderer', () => ({
  useFileService: () => ({ state: { currentFile: { content: {} } } }),
  ContextMenu: (): React.ReactElement | null => null,
  // Stand-in for the real viewer: records the raw markdown it was handed, which
  // is the whole contract this test is about.
  MarkdownViewer: ({ value }: { value: string }): React.ReactElement => (
    <div data-testid="markdown-viewer">{value}</div>
  ),
  Table: (): React.ReactElement | null => null
}))

vi.mock('./ApiUpdateSettingsSection', () => ({
  ApiUpdateSettingsSection: (): React.ReactElement | null => null
}))

vi.mock('../MainView/Workbench/EmptyBenchCards/RequestListRow', () => ({
  RequestListRow: (): React.ReactElement | null => null
}))

vi.mock('../../services/favoritesStore', () => ({
  addFavorite: vi.fn(),
  getFavorites: () => [],
  isFavorite: () => false,
  removeFavorite: vi.fn(),
  reorderFavorites: vi.fn()
}))

import EnvironmentFolderHome from './EnvironmentFolderHome'

const MARKDOWN = 'Swagger at [https://swagger.io](https://swagger.io) — see the docs.'

function makeFolder(description?: string): EnvironmentFolder {
  return {
    id: 'f1',
    name: 'Petstore',
    folderType: 'environment',
    tags: [],
    configuration: {},
    items: [],
    environments: [],
    ...(description === undefined ? {} : { apiDocumentation: { api: { description } } })
  } as unknown as EnvironmentFolder
}

describe('EnvironmentFolderHome description', () => {
  it('renders the API description through the markdown viewer', () => {
    render(<EnvironmentFolderHome folder={makeFolder(MARKDOWN)} onSwitchTab={vi.fn()} />)

    const viewer = screen.getByTestId('markdown-viewer')
    expect(viewer.textContent).toBe(MARKDOWN)
    // The description must not ALSO sit in a bare text node — that was the bug.
    const container = screen.getByTestId('folder-home-description')
    expect(container.querySelector('[data-testid="markdown-viewer"]')).not.toBeNull()
  })

  it('hands the viewer the full source rather than a truncated one', () => {
    // Truncating markdown can split a link token and leave its raw syntax on
    // screen, so the summary is capped by height in CSS instead.
    const long = `${'x'.repeat(500)} [link](https://example.com)`
    render(<EnvironmentFolderHome folder={makeFolder(long)} onSwitchTab={vi.fn()} />)

    expect(screen.getByTestId('markdown-viewer').textContent).toBe(long)
  })

  it('renders no description block when the folder has none', () => {
    render(<EnvironmentFolderHome folder={makeFolder()} onSwitchTab={vi.fn()} />)

    expect(screen.queryByTestId('folder-home-description')).toBeNull()
  })
})
