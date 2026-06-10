import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { createElement, type FC } from 'react'

/**
 * Consistency guard: each per-kind box manually declares its left/right cells,
 * separately from the port spec in `scenarioNodePorts`. The box-level handle
 * layout positions a port's handle by matching it to the cell row carrying that
 * `data-port-id` — so a cell whose id drifts from the spec (or a missing cell)
 * silently breaks a handle. This test renders every kind's box and asserts that
 * every spec port (from `defaultPortsForKind`) has a matching rendered cell, and
 * that the header launch trigger shows exactly when the kind `acceptsInputEvent`.
 *
 * React Flow + the editor contexts are stubbed so each box renders standalone
 * (no provider tree). The mocked `Handle` exposes its id so the header `in`
 * trigger is queryable; the cell rows carry their own real `data-port-id`.
 */
// ECUI resolves to its built dist in vitest (whose CSS side-imports don't
// resolve), and its widgets are irrelevant to a cell↔port check anyway. Stub
// the whole module: every named export becomes an inert component / no-op, so
// `<Button/>`, `<BorderBeam/>`, `getContrastColor()` etc. all render nothing.
vi.mock('electron-core-ui/renderer', () => {
  const C = (): null => null // inert component / function stub
  return {
    __esModule: true,
    BorderBeam: C, Button: C, CodeEditor: C, ColorPicker: C, ContextMenu: C, ControlGroup: C,
    DateTimePicker: C, InputBox: C, ListView: C, MarkdownEditor: C, MarkdownViewer: C,
    Modal: C, RadioGroup: C, ScrollableElement: C, SelectBox: C, Tab: C, Tabs: C,
    Toggle: C, Tooltip: C, VerticalSashContainer: C,
    getContrastColor: () => '#000000',
    eventBus: { emit: () => undefined, on: () => () => undefined, off: () => undefined },
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
    createElement('div', { 'data-mock-handle': '', 'data-handle-id': props.id ?? '', 'data-handle-type': props.type ?? '' }),
  useNodeConnections: () => [],
  useNodesData: () => null,
  useUpdateNodeInternals: () => () => undefined,
  // Boxes that read the graph store (e.g. retry's "is an httpRequest in scope")
  // run their selector against an empty graph — no provider tree here.
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
// The cell CONTENT (typed-value editor) is irrelevant here — only the cell's
// port row matters — and it pulls in heavy ECUI widgets, so stub it.
vi.mock('../../TypedValueField', () => ({
  TypedValueField: () => createElement('div', { 'data-stub': 'typed-value-field' })
}))

import { nodeBoxForKind } from './index'
import { SCENARIO_NODE_CATALOGUE } from '../scenarioNodeCatalogue'
import { defaultPortsForKind } from '../../../../../shared/scenarioNodePorts'
import { acceptsInputEvent } from '../../../../../shared/scenarioNodeCapabilities'
import type { ScenarioNodeKind } from '../../../../../shared/types/collections'

// Kinds whose left/right cells are NOT a 1:1 image of the static port spec, so
// the "every spec port has a cell" invariant doesn't hold for them by design
// (cells drive the handles, so a spec port with no cell simply draws no handle):
//   - runScenario : ports derived from the referenced sub-scenario, not the spec.
//   - httpRequest : the `env` cell renders only when the request sits under an
//                   environment folder; body inputs are dynamic (config-driven).
//   - output      : renders config-driven output-declaration rows, not a fixed
//                   `value` cell.
// All still get their launch-trigger checked below.
// Some kinds render certain operand ports CONDITIONALLY by op, so no single
// default render shows every spec input port: `datetime` (amount add/subtract
// XOR other diff), `objectOp` (path get/set), `listOp` (key sort/unique/groupBy),
// `timer` (frequency XOR cron by mode; duration/endDate only when bounded).
const SPEC_DRIVEN_CELLS_EXEMPT = new Set<ScenarioNodeKind>(['runScenario', 'httpRequest', 'output', 'datetime', 'objectOp', 'listOp', 'timer'])

function propsFor(kind: ScenarioNodeKind): Record<string, unknown> {
  const { inputs, outputs } = defaultPortsForKind(kind)
  return {
    id: 'n1',
    selected: false,
    type: 'scenarioNode',
    dragging: false,
    zIndex: 0,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    deletable: true,
    selectable: true,
    draggable: true,
    width: 0,
    height: 0,
    data: {
      kind,
      config: {},
      inputs,
      outputs,
      onToggleCollapse: () => undefined,
      onHeaderContextMenu: () => undefined,
      onSetConfig: () => undefined,
      onToggleBreakpoint: () => undefined,
      scenarioId: 's'
    }
  }
}

afterEach(() => { cleanup() })

describe('node box cells stay in sync with the port spec', () => {
  for (const { kind } of SCENARIO_NODE_CATALOGUE) {
    it(`${kind}: cells match the port spec + launch trigger matches the capability`, () => {
      const Box = nodeBoxForKind(kind) as unknown as FC<Record<string, unknown>>
      const { container } = render(createElement(Box, propsFor(kind)))

      // The header launch trigger is rendered iff the kind accepts an input
      // event — the central capability — for EVERY kind.
      const hasLaunch = container.querySelector('[data-handle-id="in"]') !== null
      expect(hasLaunch, `${kind}: header launch trigger should be ${acceptsInputEvent(kind)}`).toBe(
        acceptsInputEvent(kind)
      )

      if (SPEC_DRIVEN_CELLS_EXEMPT.has(kind)) return

      // Every non-trigger spec port must have a matching rendered cell, so the
      // box-level handle layout finds a row to anchor its handle to.
      const cellPorts = new Set(
        [...container.querySelectorAll('[data-port-id]')].map((el) => el.getAttribute('data-port-id'))
      )
      const spec = defaultPortsForKind(kind)
      const expected = [...spec.inputs.filter((p) => p.id !== 'in'), ...spec.outputs].map((p) => p.id)
      for (const id of expected) {
        expect(cellPorts.has(id), `${kind}: spec port "${id}" has no rendered cell`).toBe(true)
      }
    })
  }
})
