// @vitest-environment jsdom
/**
 * The response-history control was reported as un-drivable over MCP, on the
 * theory that its click handler sat on an inner span rather than on the
 * testid'd element. These tests pin the opposite — the handler, the keyboard
 * activation and the test id are all on the same element — so the automation
 * contract is explicit and a future refactor that moves the handler inwards
 * breaks here rather than in a capture run.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const emitLocalSync = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', () => ({
  useTranslation: (): { t: (key: string) => string } => ({ t: (key: string) => key })
}))

vi.mock('electron-core-ui/renderer', () => ({
  eventBus: { emitLocalSync },
  // Mirrors the real ECUI Button's structure: the test id, the click handler,
  // the keyboard handler and the role all live on ONE anchor, with the icon as
  // an inner span.
  Button: ({
    icon,
    onClick,
    'data-testid': dataTestId
  }: {
    icon: string
    onClick: (e: { stopPropagation: () => void }) => void
    'data-testid': string
  }): React.ReactElement => (
    <a
      data-testid={dataTestId}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(e as unknown as { stopPropagation: () => void }) }}
    >
      <span className={`codicon codicon-${icon}`} />
    </a>
  )
}))

vi.mock('./HeaderHoverTooltip', () => ({
  HeaderHoverTooltip: ({ children }: { children: React.ReactNode }): React.ReactElement => <>{children}</>
}))

import { RequestHeaderHistoryButton } from './RequestHeaderHistoryButton'

const TESTID = 'request-header-history-button-req-1'

beforeEach(() => { emitLocalSync.mockClear() })

describe('RequestHeaderHistoryButton', () => {
  it('opens the history modal from a click on the testid element itself', () => {
    render(<RequestHeaderHistoryButton requestId="req-1" />)

    // `.click()` on the testid'd node — exactly what an MCP driver does.
    screen.getByTestId(TESTID).click()

    expect(emitLocalSync).toHaveBeenCalledWith('request:history:open', { requestId: 'req-1' })
  })

  it('is keyboard-activatable', () => {
    render(<RequestHeaderHistoryButton requestId="req-1" />)
    const button = screen.getByTestId(TESTID)

    fireEvent.keyDown(button, { key: 'Enter' })
    expect(emitLocalSync).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(button, { key: ' ' })
    expect(emitLocalSync).toHaveBeenCalledTimes(2)
  })

  it('exposes the test id on the focusable element, not on an inner span', () => {
    render(<RequestHeaderHistoryButton requestId="req-1" />)
    const button = screen.getByTestId(TESTID)

    expect(button.getAttribute('role')).toBe('button')
    expect(button.getAttribute('tabindex')).toBe('0')
    // The codicon is a child — driving the CHILD is not required.
    expect(button.querySelector('.codicon')).not.toBeNull()
  })

  it('scopes the event to its own request id', () => {
    render(<RequestHeaderHistoryButton requestId="req-2" />)
    screen.getByTestId('request-header-history-button-req-2').click()

    expect(emitLocalSync).toHaveBeenCalledWith('request:history:open', { requestId: 'req-2' })
  })
})
