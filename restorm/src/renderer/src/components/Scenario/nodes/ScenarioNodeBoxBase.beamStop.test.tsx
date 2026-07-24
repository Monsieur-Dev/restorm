// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { createElement } from 'react'

/**
 * A running node box orbits a border beam and stops it on the next lap
 * boundary. Under reduced motion the trail carries `animation: none`, so no
 * lap boundary ever arrives — the beam has to stop immediately instead, or it
 * orbits the box forever after the run ends.
 *
 * React Flow + the editor contexts are stubbed so the box renders standalone,
 * mirroring the recipe in `scenarioNodePortCells.test.tsx`; `BorderBeam` is a
 * queryable marker rather than the inert stub used there.
 */
vi.mock('electron-core-ui/renderer', () => {
  const C = (): null => null
  return {
    __esModule: true,
    BorderBeam: () => createElement('div', { 'data-testid': 'beam-overlay' }),
    Button: C, CodeEditor: C, ColorPicker: C, ContextMenu: C, ControlGroup: C,
    DateTimePicker: C, InputBox: C, ListView: C, MarkdownEditor: C, MarkdownViewer: C,
    Modal: C, RadioGroup: C, ScrollableElement: C, SelectBox: C, Tab: C, Tabs: C,
    Toggle: C, Tooltip: C, VerticalSashContainer: C,
    getContrastColor: () => '#000000',
    eventBus: { emit: () => undefined, on: () => () => undefined, off: () => undefined, subscribe: () => ({ unsubscribe: () => undefined }) },
    isUndoKeyEvent: () => false,
    isRedoKeyEvent: () => false,
    usePlatform: () => ({ isMacintosh: false, isWindows: false, isLinux: true }),
    useFeature: () => ({ isEnabled: true, isLoading: false }),
    usePlatformFeature: () => ({ platform: 'desktop', isLoading: false }),
    useIsDesktop: () => true,
    checkFeature: () => true,
    getPlatform: () => 'desktop'
  }
})
vi.mock('@xyflow/react', () => ({
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
  Handle: (props: { id?: string; type?: string }) =>
    createElement('div', { 'data-mock-handle': '', 'data-handle-id': props.id ?? '' }),
  useNodeConnections: () => [],
  useNodesData: () => null,
  useUpdateNodeInternals: () => () => undefined,
  useStore: (selector: (s: { edges: unknown[]; nodeLookup: Map<string, unknown> }) => unknown) =>
    selector({ edges: [], nodeLookup: new Map() })
}))
vi.mock('../scenarioErrorsContext', () => ({
  useScenarioNodeErrors: () => [],
  useScenarioFieldInvalid: () => false
}))
vi.mock('../scenarioInternalsContext', () => ({
  useScenarioInternalsRequester: () => undefined
}))
vi.mock('../../../hooks/useAllEnvValueTypeGroups', () => ({
  useAllEnvValueTypeGroups: () => []
}))

import { ScenarioNodeBoxBase } from './ScenarioNodeBoxBase'
import { SCENARIO_KINDS } from '../../../../../shared/scenarioKindRegistry'

/** Pin `prefers-reduced-motion` for the duration of a test. */
function setReducedMotion(reduce: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false)
  })) as unknown as typeof window.matchMedia
}

/** A minimal box whose engine-owned `running` flag drives the beam. */
function boxWith(running: boolean): React.ReactElement {
  const data = {
    kind: SCENARIO_KINDS[0],
    config: {},
    inputs: [],
    outputs: [],
    running,
    onToggleCollapse: () => undefined,
    onHeaderContextMenu: () => undefined,
    onSetConfig: () => undefined,
    onToggleBreakpoint: () => undefined,
    scenarioId: 's'
  }
  return <ScenarioNodeBoxBase id="n1" data={data as never} left={[]} right={[]} />
}

/** The start path mounts the beam inside a `requestAnimationFrame`. */
async function settleFrames(): Promise<void> {
  await act(async () => { await new Promise((r) => requestAnimationFrame(() => { r(undefined) })) })
}

afterEach(() => { cleanup() })

describe('ScenarioNodeBoxBase running beam', () => {
  it('drops the beam at once under reduced motion, where no lap ever completes', async () => {
    setReducedMotion(true)
    const { rerender, queryByTestId } = render(boxWith(true))
    await settleFrames()
    expect(queryByTestId('beam-overlay')).not.toBeNull()

    rerender(boxWith(false))
    expect(queryByTestId('beam-overlay')).toBeNull()
  })

  it('keeps the beam until the current lap ends when motion is allowed', async () => {
    setReducedMotion(false)
    const { rerender, queryByTestId } = render(boxWith(true))
    await settleFrames()
    expect(queryByTestId('beam-overlay')).not.toBeNull()

    rerender(boxWith(false))
    // Still orbiting: the graceful stop waits for the lap boundary.
    expect(queryByTestId('beam-overlay')).not.toBeNull()
  })

  it('restarts cleanly after a reduced-motion stop', async () => {
    setReducedMotion(true)
    const { rerender, queryByTestId } = render(boxWith(true))
    await settleFrames()

    rerender(boxWith(false))
    expect(queryByTestId('beam-overlay')).toBeNull()

    rerender(boxWith(true))
    await settleFrames()
    expect(queryByTestId('beam-overlay')).not.toBeNull()
  })
})
