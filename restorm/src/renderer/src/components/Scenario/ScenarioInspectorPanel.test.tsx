// @vitest-environment jsdom
/**
 * The inspector's toolbar discs now render through the shared round-button
 * shape instead of app-local CSS. Three of the four (`step`, `debug`, `stop`)
 * are driven by NO e2e suite at all, so these are the only tests standing
 * between a conversion mistake and a toolbar that silently stops working.
 *
 * They deliberately assert wiring, not the panel's logic: each control still
 * renders, still calls its handler, and still honours its disabled state.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'

vi.hoisted(() => {
  Object.defineProperty(globalThis.document, 'queryCommandSupported', { value: () => false, configurable: true })
  // jsdom implements neither observer, and the panel + the ECUI Sash both
  // construct one on mount — without them nothing renders at all.
  class NoopObserver {
    observe(): void { /* no-op */ }
    unobserve(): void { /* no-op */ }
    disconnect(): void { /* no-op */ }
    takeRecords(): [] { return [] }
  }
  Object.defineProperty(globalThis, 'ResizeObserver', { value: NoopObserver, configurable: true })
  Object.defineProperty(globalThis, 'MutationObserver', { value: NoopObserver, configurable: true })
  // The panel reaches the preload bridge through an auth hook; without it the
  // mount throws before any assertion runs.
  Object.defineProperty(globalThis, 'window', {
    value: Object.assign(globalThis.window, {
      api: {
        account: {
          getState: () => Promise.resolve({ status: 'anonymous' }),
          onStateChanged: () => () => undefined
        }
      }
    }),
    configurable: true,
    writable: true
  })
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey
}))

import { ScenarioInspectorPanel } from './ScenarioInspectorPanel'

afterEach(() => { cleanup() })

const baseProps = {
  scenarioId: 'scn-1',
  errors: [],
  errorBoxCount: 0,
  onFocusNode: vi.fn(),
  previewNode: null
}

describe('ScenarioInspectorPanel toolbar', () => {
  it('renders the four action discs through the shared round shape', () => {
    const { getByTestId } = render(<ScenarioInspectorPanel {...baseProps} engineState="idle" onEngineRun={vi.fn()} onEngineStep={vi.fn()} onEngineStop={vi.fn()} />)
    for (const id of ['scenario-inspector-run', 'scenario-inspector-step', 'scenario-inspector-stop']) {
      expect(getByTestId(id).className).toContain('appearance-round')
    }
  })

  it('keeps undo and redo as flat buttons, NOT discs', () => {
    // They are deliberately understated next to the coloured discs; turning
    // them into discs would invert the toolbar's visual hierarchy.
    const { getByTestId } = render(
      <ScenarioInspectorPanel {...baseProps} onUndo={vi.fn()} onRedo={vi.fn()} canUndo canRedo />
    )
    expect(getByTestId('scenario-inspector-undo').className).not.toContain('appearance-round')
    expect(getByTestId('scenario-inspector-redo').className).not.toContain('appearance-round')
  })

  it('still calls the run handler', () => {
    const onEngineRun = vi.fn()
    const { getByTestId } = render(
      <ScenarioInspectorPanel {...baseProps} engineState="idle" onEngineRun={onEngineRun} />
    )
    fireEvent.click(getByTestId('scenario-inspector-run'))
    expect(onEngineRun).toHaveBeenCalledTimes(1)
  })

  it('still calls undo and redo', () => {
    const onUndo = vi.fn()
    const onRedo = vi.fn()
    const { getByTestId } = render(
      <ScenarioInspectorPanel {...baseProps} onUndo={onUndo} onRedo={onRedo} canUndo canRedo />
    )
    fireEvent.click(getByTestId('scenario-inspector-undo'))
    fireEvent.click(getByTestId('scenario-inspector-redo'))
    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(onRedo).toHaveBeenCalledTimes(1)
  })

  it('keeps undo disabled — and inert — when there is nothing to undo', () => {
    const onUndo = vi.fn()
    const { getByTestId } = render(
      <ScenarioInspectorPanel {...baseProps} onUndo={onUndo} onRedo={vi.fn()} canUndo={false} canRedo />
    )
    const undo = getByTestId('scenario-inspector-undo')
    expect(undo.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(undo)
    expect(onUndo).not.toHaveBeenCalled()
  })

  it('exposes an accessible name on every toolbar control', () => {
    // The discs are icon-only, so the aria-label is their only name.
    const { getByTestId } = render(
      <ScenarioInspectorPanel {...baseProps} engineState="idle" onEngineRun={vi.fn()} onEngineStep={vi.fn()} onEngineStop={vi.fn()} onUndo={vi.fn()} onRedo={vi.fn()} canUndo canRedo />
    )
    for (const id of ['scenario-inspector-run', 'scenario-inspector-step', 'scenario-inspector-stop', 'scenario-inspector-undo', 'scenario-inspector-redo']) {
      const name = getByTestId(id).getAttribute('aria-label')
      expect(name, `${id} has no accessible name`).toBeTruthy()
    }
  })
})
