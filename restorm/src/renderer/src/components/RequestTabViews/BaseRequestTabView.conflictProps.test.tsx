// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import type React from 'react'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key })
}))

// jsdom has no ResizeObserver — BaseRequestTabView uses one to detect the
// compact-layout breakpoint. A no-op stub is enough; layout behavior itself
// isn't under test here.
class MockResizeObserver {
  observe(): void { /* no-op — layout behavior isn't under test */ }
  unobserve(): void { /* no-op */ }
  disconnect(): void { /* no-op */ }
}
vi.stubGlobal('ResizeObserver', MockResizeObserver)

// Every leaf here (Tabs, MarkdownEditor, VerticalSashContainer, JsonViewer,
// MarkdownViewer) is heavy / Monaco-adjacent and has no unit-test precedent
// of its own in this codebase (RequestTabViews are validated by e2e) — this
// suite only proves the two additive conflict-resolution props this ticket
// introduced (`defaultActiveTabId`, `notesDiffers`) wire correctly, via a
// `Tabs` stand-in that renders every tab's id + content so both are
// assertable without a real tab-strip interaction.
vi.mock('electron-core-ui/renderer', () => ({
  Tabs: ({ tabs, activeTabId }: { tabs: { id: string, content: React.ReactNode }[], activeTabId: string }) => (
    <div data-testid="mock-tabs" data-active-tab-id={activeTabId}>
      {tabs.map((tab) => <div key={tab.id} data-testid={`mock-tab-${tab.id}`}>{tab.content}</div>)}
    </div>
  ),
  MarkdownViewer: ({ value }: { value: string }) => <div data-testid="mock-markdown-viewer">{value}</div>,
  MarkdownEditor: ({ initialValue }: { initialValue: string }) => <div data-testid="mock-markdown-editor">{initialValue}</div>,
  VerticalSashContainer: ({ Left, Right }: { Left: React.ReactNode, Right: React.ReactNode }) => (
    <div data-testid="mock-sash">{Left}{Right}</div>
  ),
  JsonViewer: () => <div data-testid="mock-json-viewer" />,
  eventBus: { emitLocalSync: vi.fn(), subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) },
  fieldDiffStyle: (differs: boolean) => (differs ? { borderColor: 'var(--inputValidation-errorBorder, #be1100)' } : undefined)
}))

import { BaseRequestTabView } from './BaseRequestTabView'

afterEach(() => { cleanup() })

const baseProps = {
  requestId: 'r1',
  urlSection: <div data-testid="url-section" />,
  requestContent: <div data-testid="request-content" />,
  codeSnippetsContent: '',
  isLoading: false,
  showResponse: false
}

describe('BaseRequestTabView — conflict-resolution passthrough props', () => {
  it('defaults to the request tab when defaultActiveTabId is not set', () => {
    render(<BaseRequestTabView {...baseProps} />)
    expect(screen.getByTestId('mock-tabs').getAttribute('data-active-tab-id')).toBe('request')
  })

  it('seeds the initial tab from defaultActiveTabId (e.g. "notes", the conflict-bearing tab)', () => {
    render(<BaseRequestTabView {...baseProps} defaultActiveTabId="notes" />)
    expect(screen.getByTestId('mock-tabs').getAttribute('data-active-tab-id')).toBe('notes')
  })

  it('does not red-border the notes editor when notesDiffers is unset (live, non-conflict editor)', () => {
    render(<BaseRequestTabView {...baseProps} notes="hello" />)
    const wrapper = screen.getByTestId('mock-tab-notes').firstElementChild as HTMLElement
    expect(wrapper.style.borderColor).toBe('transparent')
  })

  it('red-borders the notes editor when notesDiffers is true', () => {
    render(<BaseRequestTabView {...baseProps} notes="hello" notesDiffers />)
    const wrapper = screen.getByTestId('mock-tab-notes').firstElementChild as HTMLElement
    expect(wrapper.style.borderColor).toContain('inputValidation-errorBorder')
  })
})
