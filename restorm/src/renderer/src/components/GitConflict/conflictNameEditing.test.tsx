// @vitest-environment jsdom
/**
 * The resolved column's name box is the only place a contested rename can
 * be settled — including on a third name neither side proposed. It is fed
 * from the resolved copy, so a typed value that does not land in state
 * snaps back on the next render and the user silently publishes the name
 * they thought they had replaced.
 */
import { useState } from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'

// jsdom implements no editing commands, and the probe happens at import
// time inside the ECUI barrel — so it has to be stubbed before any import.
vi.hoisted(() => {
  Object.defineProperty(globalThis.document, 'queryCommandSupported', { value: () => false, configurable: true })
})

vi.mock('react-i18next', () => ({  // The placeholder hint draws a codicon inline via <Trans>.
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
 useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../contexts/EnvironmentContext', () => ({
  EnvironmentProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))
vi.mock('../RequestTabViews/HTTPRequestTabView', () => ({
  HTTPRequestTabView: ({ request }: { request: { name: string } }) => (
    <div data-testid="mock-http-view">{request.name}</div>
  )
}))

import { ConflictEntityPanel } from './ConflictEntityPanel'
import { useConflictResolution } from '../../hooks/useConflictResolution'
import type { FolderItem } from '../../../../shared/types/folderTypes'

afterEach(() => { cleanup() })

const request = { id: 'r1', name: 'Fetch a pet', type: 'http', tags: [] } as unknown as FolderItem

/** Mirrors the modal's resolved column: state-owned entity + the capture
 * handlers it wraps the panel in. */
function ResolvedColumn(): React.JSX.Element {
  const [entity, setEntity] = useState<FolderItem>(request)
  return (
    <div onInputCapture={() => undefined} onChangeCapture={() => undefined}>
      <ConflictEntityPanel
        entity={entity}
        mode="editable"
        fieldDiff={{ fields: { name: true } }}
        onNameChange={(name) => { setEntity((prev) => ({ ...prev, name })) }}
        data-testid="resolved"
      />
    </div>
  )
}

describe('editing the resolved name', () => {
  it('keeps a third name the user typed', () => {
    render(<ResolvedColumn />)
    const input = screen.getByTestId<HTMLInputElement>('resolved-name-input-input')

    fireEvent.change(input, { target: { value: 'Find a pet by its ID' } })

    expect(input.value).toBe('Find a pet by its ID')
    // With the rename as the whole conflict there is no entity view at
    // all — the name row is the entire arbitration surface.
    expect(screen.queryByTestId('mock-http-view')).toBeNull()
  })
})

const OURS = [
  'collections:',
  '  - id: r1',
  '    name: Find pet by ID',
  '    type: http',
  '    tags: []',
  '    url: https://example.com/ping'
].join('\n')
const THEIRS = OURS.replace('Find pet by ID', 'Fetch a pet')
const BASE = OURS.replace('Find pet by ID', 'HTTP sample')

const VERSIONS = { path: 'p.restorm', base: BASE, ours: OURS, theirs: THEIRS }

/** The modal's resolved column driven by the REAL resolution hook — the
 * reactive-proxy copies and the per-pick remount key are what a local
 * useState host cannot reproduce. */
function HookedColumn(): React.JSX.Element {
  const cr = useConflictResolution(VERSIONS)
  const id = cr.conflicts[0]?.id ?? ''
  const resolved = cr.getResolvedEntity(id)
  return (
    <>
      <button data-testid="pick-theirs" onClick={() => { cr.pickTheirsVersion(id) }}>theirs</button>
      {resolved && (
        <div
          onInputCapture={() => { cr.onResolvedEdited(id) }}
          onChangeCapture={() => { cr.onResolvedEdited(id) }}
        >
          <ConflictEntityPanel
            key={`${id}:${cr.resolvedEpochById[id] ?? 0}`}
            entity={resolved}
            mode="editable"
            fieldDiff={{ fields: { name: true } }}
            onNameChange={(name) => { cr.setResolvedName(id, name) }}
            data-testid="resolved"
          />
        </div>
      )}
    </>
  )
}

describe('editing the resolved name through the resolution hook', () => {
  it('keeps a third name typed after picking a side', () => {
    render(<HookedColumn />)
    fireEvent.click(screen.getByTestId('pick-theirs'))

    const input = screen.getByTestId<HTMLInputElement>('resolved-name-input-input')
    expect(input.value).toBe('Fetch a pet')

    fireEvent.change(input, { target: { value: 'Find a pet by its ID' } })

    expect(input.value).toBe('Find a pet by its ID')
    expect(screen.getByTestId<HTMLInputElement>('resolved-name-input-input').value).toBe('Find a pet by its ID')
  })
})
