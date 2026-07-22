import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BaseFolderView } from './BaseFolderView'
import type { Folder } from '../../../../shared/types/collections'

vi.mock('react-i18next', () => ({
  useTranslation: (): { t: (key: string) => string } => ({ t: (key: string) => key })
}))

vi.mock('electron-core-ui/renderer', () => ({
  Tabs: ({ tabs }: { tabs: { id: string, content: React.ReactNode }[] }): React.ReactElement => <div>{tabs.map((tab) => <div key={tab.id}>{tab.content}</div>)}</div>,
  MarkdownEditor: (): React.ReactElement => <div data-testid="markdown-editor" />,
  fieldDiffStyle: (differs: boolean): Record<string, string> => (differs ? { borderColor: 'red' } : {})
}))

function makeFolder(): Folder {
  return { id: 'f1', name: 'My folder', tags: [], configuration: {}, items: [] } as unknown as Folder
}

describe('BaseFolderView contested tabs', () => {
  it('borders the tab content a folder conflict actually contests', () => {
    // Without this, an environment-variable conflict highlighted nothing:
    // the user had to compare two environment trees by eye.
    render(
      <BaseFolderView
        folder={makeFolder()}
        additionalTabs={[{ id: 'environments', label: 'Env', content: <div data-testid="env-content" /> }]}
        contestedTabIds={['environments']}
      />
    )

    expect(screen.getByTestId('env-content').parentElement?.getAttribute('style')).toContain('border')
  })

  it('leaves an uncontested tab unwrapped', () => {
    render(
      <BaseFolderView
        folder={makeFolder()}
        additionalTabs={[{ id: 'environments', label: 'Env', content: <div data-testid="env-content" /> }]}
      />
    )

    expect(screen.getByTestId('env-content').parentElement?.getAttribute('style') ?? '').not.toContain('border')
  })
})
