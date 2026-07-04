// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, within } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'

// The ECUI renderer barrel side-loads Monaco / CSS that don't resolve under
// vitest. Stub the primitives this component uses. `Tabs` renders EVERY tab's
// content (each wrapped in `tab-<id>`) so a test can assert the content built
// for a specific response tab without driving tab selection.
interface StubTab { id: string; label: ReactNode; content: ReactNode }
vi.mock('electron-core-ui/renderer', () => ({
  Tabs: ({ tabs }: { tabs: StubTab[] }): ReactNode =>
    createElement(
      'div',
      null,
      tabs.map((tab) => createElement('div', { key: tab.id, 'data-testid': `tab-${tab.id}` }, tab.content))
    ),
  VerticalSashContainer: ({ Left, Right }: { Left: ReactNode; Right: ReactNode }): ReactNode =>
    createElement('div', null, Left, Right),
  MarkdownViewer: (): ReactNode => null,
  MarkdownEditor: (): ReactNode => null,
  JsonViewer: (): ReactNode => createElement('div', { 'data-testid': 'json-viewer' }),
  eventBus: { emitLocalSync: vi.fn() }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import { BaseRequestTabView, type BaseRequestTabViewProps } from './BaseRequestTabView'

const LOADING = 'requestTab.responses.loading'
const NO_BODY = 'requestTab.responses.noResponseBody'

const baseProps: BaseRequestTabViewProps = {
  requestId: 'req-1',
  urlSection: null,
  requestContent: null,
  codeSnippetsContent: '',
  isLoading: false,
  showResponse: false
}

beforeEach(() => {
  // jsdom lacks ResizeObserver; the compact-mode measurement effect needs one.
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void { /* no-op */ }
    unobserve(): void { /* no-op */ }
    disconnect(): void { /* no-op */ }
  }
})

afterEach(() => {
  cleanup()
})

describe('BaseRequestTabView response panel state', () => {
  it('shows the sending placeholder only while genuinely in-flight, then a no-body notice once resolved', () => {
    // A first successful response: the Response tab renders the body and
    // latches `hadResponseOnce` so the tab stays visible afterwards.
    const { rerender, getByTestId } = render(
      <BaseRequestTabView
        {...baseProps}
        showResponse
        responseContent={<div data-testid="real-body">BODY</div>}
      />
    )
    expect(within(getByTestId('tab-response')).getByTestId('real-body')).toBeTruthy()

    // Same request re-sent, now in-flight with no body yet → the Response tab
    // shows the sending indicator (in-flight is the only time it may appear).
    rerender(
      <BaseRequestTabView
        {...baseProps}
        showResponse
        isLoading
        responseContent={undefined}
      />
    )
    const responseWhileLoading = getByTestId('tab-response')
    expect(responseWhileLoading.textContent).toContain(LOADING)
    expect(responseWhileLoading.textContent).not.toContain(NO_BODY)

    // The request resolves to an error / no body (isLoading false, no content).
    // The sending indicator must clear; the Response tab now reads as no-body,
    // never lingering on "Sending…".
    rerender(
      <BaseRequestTabView
        {...baseProps}
        showResponse
        isLoading={false}
        responseContent={undefined}
      />
    )
    const responseResolved = getByTestId('tab-response')
    expect(responseResolved.textContent).toContain(NO_BODY)
    expect(responseResolved.textContent).not.toContain(LOADING)
  })

  it('applies the same in-flight vs no-body distinction to the Graph tab', () => {
    // Seed `hadJsonOnce` so the Graph tab stays visible after the JSON clears.
    const { rerender, getByTestId } = render(
      <BaseRequestTabView {...baseProps} showResponse jsonData={{ ok: true }} />
    )
    expect(within(getByTestId('tab-graph')).getByTestId('json-viewer')).toBeTruthy()

    rerender(<BaseRequestTabView {...baseProps} showResponse isLoading jsonData={undefined} />)
    expect(getByTestId('tab-graph').textContent).toContain(LOADING)

    rerender(<BaseRequestTabView {...baseProps} showResponse isLoading={false} jsonData={undefined} />)
    const graphResolved = getByTestId('tab-graph')
    expect(graphResolved.textContent).toContain(NO_BODY)
    expect(graphResolved.textContent).not.toContain(LOADING)
  })

  it('keeps the Infos tab authoritative for the resolved state (no lingering sending text)', () => {
    const { getByTestId } = render(
      <BaseRequestTabView
        {...baseProps}
        showResponse
        isLoading={false}
        infosContent={<div data-testid="error-infos">connection refused</div>}
        responseContent={undefined}
      />
    )
    expect(within(getByTestId('tab-infos')).getByTestId('error-infos')).toBeTruthy()
    expect(getByTestId('tab-infos').textContent).not.toContain(LOADING)
  })
})
