// @vitest-environment jsdom
/**
 * Regression: reordering a KeyValueTable row whose value renders a Monaco
 * editor crashed the renderer — StrictMode's dev-only dispose→reconnect of a
 * moved subtree re-ran `CodeEditor`'s effects (and their deferred callbacks)
 * against an editor whose `InstantiationService` was already disposed:
 * `InstantiationService has been disposed` from the effects, then
 * `Cannot read properties of undefined (reading 'domNode')` from a render
 * scheduled before the dispose landed.
 *
 * The Workbench StrictMode harness (`EditorWorkbench.strictmode.test.tsx`)
 * pins the RECONNECT side (a reorder must not disconnect/reconnect a tab's
 * effects). This file pins the editor-guard side, driving the exact calls
 * the reconnect produced: after the mounted editor is DISPOSED,
 * - re-running the marker/decoration effects (a `tolerateHandlebars` or
 *   state flip re-triggers them) must not touch the dead instance, and
 * - the deferred `onDidChangeMarkers` handler (Monaco's validators answer on
 *   their own schedule) must not either.
 * The fake editor throws exactly like Monaco does on any post-dispose call,
 * so a missing guard turns these tests red with the production error.
 */
import React, { StrictMode } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'

/** Flush the fake editor's async creation (a microtask, like the loader). */
async function flushEditorInit(): Promise<void> {
  await act(async () => { await Promise.resolve() })
}

type MarkerHandler = (resources: { toString(): string }[]) => void

interface FakeModel {
  uri: { toString(): string }
  getValue(): string
  getLanguageId(): string
}

function makeFakeEditor(): {
  editor: Record<string, unknown> & { dispose(): void }
  isDisposed(): boolean
} {
  let disposed = false
  const disposeListeners: (() => void)[] = []
  const model: FakeModel = {
    uri: { toString: () => 'inmemory://model/1' },
    getValue: () => '{{petId}}',
    getLanguageId: () => 'plaintext'
  }
  const assertLive = (): void => {
    if (disposed) throw new Error('InstantiationService has been disposed')
  }
  const editor = {
    getModel: () => { assertLive(); return model },
    getValue: () => { assertLive(); return '{{petId}}' },
    setValue: (_v: string) => { assertLive() },
    updateOptions: (_o: unknown) => { assertLive() },
    createDecorationsCollection: (_d: unknown[]) => {
      assertLive()
      return { set: (_x: unknown[]) => { assertLive() }, clear: () => { /* clearing after dispose is fine */ } }
    },
    onDidChangeModelContent: (_cb: () => void) => { assertLive(); return { dispose: () => { /* no-op */ } } },
    onDidChangeModel: (_cb: () => void) => { assertLive(); return { dispose: () => { /* no-op */ } } },
    onDidDispose: (cb: () => void) => { disposeListeners.push(cb); return { dispose: () => { /* no-op */ } } },
    addAction: (_a: unknown) => { /* mount-time, pre-dispose */ },
    getDomNode: () => null,
    dispose: () => {
      disposed = true
      for (const cb of disposeListeners) cb()
    }
  }
  return { editor, isDisposed: () => disposed }
}

const markerHandlers: MarkerHandler[] = []

const fakeMonaco = {
  editor: {
    getModelMarkers: (_q: unknown) => [
      { owner: 'json', message: 'x', severity: 8 }
    ],
    setModelMarkers: (_m: unknown, _o: string, _k: unknown[]) => { /* recorded implicitly via throw-free path */ },
    onDidChangeMarkers: (cb: MarkerHandler) => {
      markerHandlers.push(cb)
      return { dispose: () => { /* keep — tests fire it manually */ } }
    },
    TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: 1 }
  },
  Range: class {
    readonly parts: unknown[]
    constructor(...parts: unknown[]) { this.parts = parts }
  },
  KeyMod: { CtrlCmd: 2048 },
  KeyCode: { F12: 70 }
}

// One fake editor per Editor mount; the CURRENT one is what tests dispose.
let currentFake: ReturnType<typeof makeFakeEditor> | null = null

// `monacoBootstrap` imports the real `monaco-editor` (workers, clipboard
// probes) at module scope — none of it loads under jsdom, and none of it is
// under test here.
vi.mock('./monacoBootstrap', () => ({ bootstrapMonaco: () => { /* no-op */ } }))

const FakeMonacoEditor: React.FC<{ onMount?: (editor: unknown, monaco: unknown) => void }> = ({ onMount }) => {
  // Latest-callback ref, the same shape the real library uses — the mount
  // effect must run once per MOUNT (not once per onMount identity, which
  // changes every parent render). Synced in its own effect (declared first,
  // so it runs before the mount effect at mount time).
  const onMountRef = React.useRef(onMount)
  React.useEffect(() => { onMountRef.current = onMount }, [onMount])
  React.useEffect(() => {
    // ASYNC creation, like the real library (its loader resolves in a
    // microtask at best). Fidelity matters: StrictMode's initial
    // mount→cleanup→mount double-invoke reaches the first cleanup BEFORE
    // anything was created, so no dispose fires there — a synchronous fake
    // disposed a live editor at first cleanup, which (combined with the
    // component's remount-on-dispose recovery) spun mount→dispose→remount
    // forever, a loop the real library never enters.
    let mine: ReturnType<typeof makeFakeEditor> | null = null
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      mine = makeFakeEditor()
      currentFake = mine
      onMountRef.current?.(mine.editor, fakeMonaco)
    })
    return () => {
      // Mirror the library: cancel a pending init, dispose a live editor.
      if (mine) mine.editor.dispose()
      else cancelled = true
    }
  }, [])
  return <div data-testid="fake-monaco" />
}

vi.mock('@monaco-editor/react', () => ({
  default: (props: { onMount?: (editor: unknown, monaco: unknown) => void }) => (
    <FakeMonacoEditor {...(props.onMount ? { onMount: props.onMount } : {})} />
  )
}))

import { CodeEditor } from './CodeEditor'

beforeEach(() => {
  currentFake = null
  markerHandlers.length = 0
})

describe('CodeEditor — no editor call survives a dispose', () => {
  it('re-running the handlebars effects against a disposed editor stays silent', async () => {
    const view = render(
      <StrictMode>
        <CodeEditor value="{{petId}}" tolerateHandlebars={false} />
      </StrictMode>
    )
    await flushEditorInit()
    expect(currentFake).not.toBeNull()

    // The reconnect scenario: the mounted editor gets disposed while React
    // still holds it in state, then the effects re-run (here: the
    // tolerateHandlebars flip arms the marker + decoration effects, which
    // read the dead instance first).
    act(() => { currentFake?.editor.dispose() })
    expect(currentFake?.isDisposed()).toBe(true)

    expect(() => {
      view.rerender(
        <StrictMode>
          <CodeEditor value="{{petId}}" tolerateHandlebars={true} />
        </StrictMode>
      )
    }).not.toThrow()
  })

  it('defuses the disposed instance for OUT-OF-REACH holders and remounts a fresh editor', async () => {
    // The real crash path runs INSIDE @monaco-editor/react: its reconnect
    // effects call setModel / executeEdits / re-subscribe content listeners
    // through its own refs on the editor it just disposed, and it never
    // recreates one once its ready-latch is set. No guard in CodeEditor's
    // effects can intercept those calls — the instance itself must become
    // inert, and the library must be remounted for a live replacement.
    render(
      <StrictMode>
        <CodeEditor value="{{petId}}" tolerateHandlebars={false} />
      </StrictMode>
    )
    await flushEditorInit()
    const mounted = currentFake
    expect(mounted).not.toBeNull()

    act(() => { mounted?.editor.dispose() })

    // Library-shaped post-dispose calls on the SAME object: inert, no throw.
    const corpse = mounted?.editor as unknown as {
      getModel(): unknown
      setModel(m: unknown): unknown
      executeEdits(s: string, e: unknown[]): unknown
      onDidChangeModelContent(cb: () => void): { dispose(): void }
      updateOptions(o: unknown): unknown
    }
    expect(() => {
      corpse.getModel()
      corpse.setModel({})
      corpse.executeEdits('', [])
      corpse.onDidChangeModelContent(() => undefined).dispose()
      corpse.updateOptions({})
    }).not.toThrow()

    // And the component remounted the library: a FRESH, live editor exists.
    await flushEditorInit()
    expect(currentFake).not.toBe(mounted)
    expect(currentFake?.isDisposed()).toBe(false)
  })

  it('a deferred onDidChangeMarkers callback firing after dispose stays silent', async () => {
    render(
      <StrictMode>
        <CodeEditor value="{{petId}}" tolerateHandlebars={true} />
      </StrictMode>
    )
    await flushEditorInit()
    expect(currentFake).not.toBeNull()
    // The subscription exists from the live phase…
    expect(markerHandlers.length).toBeGreaterThan(0)

    act(() => { currentFake?.editor.dispose() })

    // …and Monaco's validators answer on their own schedule, after the
    // dispose. The handler must bail, not call getModel() on the corpse.
    expect(() => {
      act(() => {
        for (const handler of markerHandlers) {
          handler([{ toString: () => 'inmemory://model/1' }])
        }
      })
    }).not.toThrow()
  })
})
