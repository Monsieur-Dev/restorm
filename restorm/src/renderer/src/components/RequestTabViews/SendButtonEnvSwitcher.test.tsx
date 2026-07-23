// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'

vi.hoisted(() => {
  Object.defineProperty(globalThis.document, 'queryCommandSupported', { value: () => false, configurable: true })
})

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../contexts/useEnvironmentContext', () => ({
  useOptionalEnvironmentContext: () => ({
    environments: [{ id: 'env-1', name: 'localhost', variables: [] }],
    selectedEnvId: 'env-1',
    projectUuid: 'proj-1',
    folderRequestIds: [],
    setFolderEnv: vi.fn(),
    setRequestOverride: vi.fn()
  })
}))

import { SendButtonEnvSwitcher } from './SendButtonEnvSwitcher'

afterEach(() => { cleanup() })

/** The wrapper's anchor. Throws rather than returning null so the tests below
 * need no non-null assertion — its absence is itself a failure. */
const anchorOf = (container: HTMLElement): HTMLElement => {
  const el = container.querySelector<HTMLElement>('[data-testid="send-button-env-switcher-anchor"]')
  if (!el) throw new Error('switcher anchor not rendered')
  return el
}

const pickerIsOpen = (): boolean =>
  document.querySelector('[data-testid="send-button-env-switcher-listview"]') !== null

describe('SendButtonEnvSwitcher inert mode', () => {
  it('opens the environment picker on right-click when enabled', () => {
    const { container } = render(
      <SendButtonEnvSwitcher><button type="button">send</button></SendButtonEnvSwitcher>
    )
    fireEvent.contextMenu(anchorOf(container))
    expect(pickerIsOpen()).toBe(true)
  })

  it('claims nothing when inert — but STAYS MOUNTED', () => {
    // Staying mounted is the whole point: unmounting this wrapper would remount
    // everything below it and restart a running border-beam mid-lap.
    const { container } = render(
      <SendButtonEnvSwitcher enabled={false}><button type="button">cancel</button></SendButtonEnvSwitcher>
    )
    fireEvent.contextMenu(anchorOf(container))
    expect(pickerIsOpen()).toBe(false)
  })

  it('lets the wrapped control keep receiving its own clicks while inert', () => {
    // The risk of keeping the wrapper mounted is that it swallows input meant
    // for the button it wraps — which would break "cancel" in a way no
    // selector-based test would notice.
    const onClick = vi.fn()
    const { container, getByRole } = render(
      <SendButtonEnvSwitcher enabled={false}>
        <button type="button" onClick={onClick}>cancel</button>
      </SendButtonEnvSwitcher>
    )
    fireEvent.click(getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
    // And the wrapper itself is taken out of hit-testing rather than merely
    // ignoring the event.
    expect(anchorOf(container).className).toContain('restorm-send-button-env-switcher-inert')
  })

  it('closes an open picker if it is disabled mid-flight', () => {
    const { container, rerender } = render(
      <SendButtonEnvSwitcher><button type="button">send</button></SendButtonEnvSwitcher>
    )
    fireEvent.contextMenu(anchorOf(container))
    expect(pickerIsOpen()).toBe(true)

    rerender(
      <SendButtonEnvSwitcher enabled={false}><button type="button">cancel</button></SendButtonEnvSwitcher>
    )
    expect(pickerIsOpen()).toBe(false)
  })
})
