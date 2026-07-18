import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { ServerConfigLockedHint } from './ServerConfigLockedHint'

afterEach(() => { cleanup() })

describe('ServerConfigLockedHint', () => {
  it('renders a lock glyph + the locked-while-running text', () => {
    const { getByTestId } = render(<ServerConfigLockedHint />)
    const hint = getByTestId('server-config-locked-hint')
    expect(hint.querySelector('.codicon-lock')).not.toBeNull()
    expect(hint.textContent).toContain('Config locked while the server is running')
  })

  it('accepts a custom test id (multiple server views on one page)', () => {
    const { getByTestId } = render(<ServerConfigLockedHint data-testid="grpc-server-locked-hint" />)
    expect(getByTestId('grpc-server-locked-hint')).not.toBeNull()
  })
})
