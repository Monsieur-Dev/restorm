import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'

/** Translations resolve; the surface's built-in English is asserted separately
 * by making the lookup fail. */
const translate = vi.fn((key: string) => key)
vi.mock('electron-core-ui/renderer', () => ({
  Button: (props: { children?: ReactNode; onClick?: () => void; 'data-testid'?: string }): ReactNode =>
    createElement('button', { onClick: props.onClick, 'data-testid': props['data-testid'] }, props.children),
  i18n: { t: (key: string): string => translate(key) }
}))

import { RendererErrorBoundary } from './RendererErrorBoundary'
import { setRendererCrashCapture } from '../../crash/rendererCrashCapture'

const Boom: React.FC = () => {
  throw new Error('render exploded')
}

/** React logs a caught render error to console.error; silence it so a passing
 * suite is not full of expected noise. */
const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
afterAll(() => { consoleError.mockRestore() })

beforeEach(() => {
  translate.mockImplementation((key: string) => key)
})

afterEach(() => {
  cleanup()
  setRendererCrashCapture(null)
  delete (window as { api?: unknown }).api
  vi.clearAllMocks()
})

describe('RendererErrorBoundary', () => {
  it('renders its children when nothing throws', () => {
    render(
      <RendererErrorBoundary>
        <div data-testid="app">the app</div>
      </RendererErrorBoundary>
    )
    expect(screen.getByTestId('app')).toBeDefined()
    expect(screen.queryByTestId('crash-recovery-surface')).toBeNull()
  })

  it('renders the recovery surface instead of a white screen', () => {
    render(
      <RendererErrorBoundary>
        <Boom />
      </RendererErrorBoundary>
    )
    expect(screen.getByTestId('crash-recovery-surface')).toBeDefined()
  })

  it('reports the error through the armed capture path', () => {
    const captured: unknown[] = []
    setRendererCrashCapture((error) => { captured.push(error) })

    render(
      <RendererErrorBoundary>
        <Boom />
      </RendererErrorBoundary>
    )

    expect(captured).toHaveLength(1)
    expect((captured[0] as Error).message).toBe('render exploded')
  })

  it('still shows the surface when reporting is disarmed', () => {
    // No capture installed — the consented-off case. The user must still get a
    // way out even though nothing is reported.
    render(
      <RendererErrorBoundary>
        <Boom />
      </RendererErrorBoundary>
    )
    expect(screen.getByTestId('crash-recovery-surface')).toBeDefined()
  })

  it('renders the surface even when the reporter throws', () => {
    setRendererCrashCapture(() => { throw new Error('reporter is broken too') })
    render(
      <RendererErrorBoundary>
        <Boom />
      </RendererErrorBoundary>
    )
    expect(screen.getByTestId('crash-recovery-surface')).toBeDefined()
  })
})

describe('CrashRecoverySurface', () => {
  it('relaunches through the bridge when the button is pressed', () => {
    const recoverRelaunch = vi.fn().mockResolvedValue(undefined)
    ;(window as unknown as { api: unknown }).api = { crash: { recoverRelaunch } }

    render(
      <RendererErrorBoundary>
        <Boom />
      </RendererErrorBoundary>
    )
    fireEvent.click(screen.getByTestId('crash-recovery-relaunch'))
    expect(recoverRelaunch).toHaveBeenCalledTimes(1)
  })

  it('offers no relaunch button when the bridge is missing', () => {
    // `window.api` is DECLARED as always carrying the bridge; a preload that
    // failed to load says otherwise. The surface must degrade to a message, not
    // throw and not offer a button that does nothing.
    render(
      <RendererErrorBoundary>
        <Boom />
      </RendererErrorBoundary>
    )
    expect(screen.getByTestId('crash-recovery-surface')).toBeDefined()
    expect(screen.queryByTestId('crash-recovery-relaunch')).toBeNull()
  })

  it('falls back to built-in English when i18n cannot answer', () => {
    // The surface renders precisely when the app failed to; i18n may be what
    // failed. A raw key on screen would be as useless as no message.
    translate.mockImplementation(() => { throw new Error('i18n not initialised') })

    render(
      <RendererErrorBoundary>
        <Boom />
      </RendererErrorBoundary>
    )
    expect(screen.getByText('Restorm ran into a problem and needs to be restarted.')).toBeDefined()
  })

  it('falls back when a key resolves to itself', () => {
    translate.mockImplementation((key: string) => key)
    render(
      <RendererErrorBoundary>
        <Boom />
      </RendererErrorBoundary>
    )
    expect(screen.getByText('Restorm ran into a problem and needs to be restarted.')).toBeDefined()
  })
})
