/**
 * Component + hook tests for the GraphQL link-status indicator shipped
 * from `electron-core-ui`. Lives in restorm because restorm owns the
 * only jsdom + @testing-library/react harness in the monorepo.
 *
 * Reaches into the library's compiled dist entry points (not the
 * renderer barrel) so the test bundler doesn't transitively pull in
 * the whole component graph — the barrel lazy-loads `jsoncrack-react`,
 * which vite can't resolve at unit-test time.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
// Reach into the library source directly. The renderer barrel
// (`electron-core-ui/renderer`) lazy-loads `jsoncrack-react`, which
// vite can't resolve at unit-test time; importing the module paths
// avoids pulling in that unrelated component graph.
import { graphQLClient } from '../../../electron-core-ui/src/renderer/services/GraphQLClient'
import { GraphQLLinkStatusIndicator } from '../../../electron-core-ui/src/renderer/components/GraphQLLinkStatus/GraphQLLinkStatusIndicator'

/**
 * Drive a status transition through the library's own
 * `setLinkStatusForTests` backdoor so the test exercises the same
 * no-op-on-same-state + listener-dispatch path the production code
 * uses, rather than mutating private state directly.
 */
function setLinkStatus(status: 'ok' | 'reconnecting' | 'failed'): void {
  act(() => {
    graphQLClient.setLinkStatusForTests(status)
  })
}

describe('<GraphQLLinkStatusIndicator>', () => {
  beforeEach(() => {
    // Each test starts from `ok` — without the reset, state bleeds across
    // describe blocks since `graphQLClient` is a singleton.
    setLinkStatus('ok')
  })

  it('renders nothing while the link is ok', () => {
    const { container } = render(<GraphQLLinkStatusIndicator />)
    expect(container.firstChild).toBeNull()
  })

  it('renders a reconnecting indicator when the link is reconnecting', () => {
    setLinkStatus('reconnecting')
    render(<GraphQLLinkStatusIndicator />)
    const element = screen.getByTestId('statusbar-graphql-link-status')
    expect(element).toBeInstanceOf(HTMLElement)
    const inner = element.querySelector('[data-status]')
    expect(inner?.getAttribute('data-status')).toBe('reconnecting')
    expect(element.querySelector('i.codicon-sync')).not.toBeNull()
  })

  it('renders a failed indicator when the link is failed', () => {
    setLinkStatus('failed')
    render(<GraphQLLinkStatusIndicator />)
    const element = screen.getByTestId('statusbar-graphql-link-status')
    const inner = element.querySelector('[data-status]')
    expect(inner?.getAttribute('data-status')).toBe('failed')
    expect(element.querySelector('i.codicon-debug-disconnect')).not.toBeNull()
  })

  it('transitions from ok → reconnecting → ok as the link status changes', () => {
    const { container } = render(<GraphQLLinkStatusIndicator />)
    expect(container.firstChild).toBeNull()

    setLinkStatus('reconnecting')
    expect(screen.getByTestId('statusbar-graphql-link-status')).toBeInstanceOf(HTMLElement)

    setLinkStatus('ok')
    expect(screen.queryByTestId('statusbar-graphql-link-status')).toBeNull()
  })

  it('forwards the className prop to the underlying <StatusbarElement>', () => {
    setLinkStatus('reconnecting')
    render(<GraphQLLinkStatusIndicator className="right-aligned" />)
    const element = screen.getByTestId('statusbar-graphql-link-status')
    expect(element.className).toContain('right-aligned')
  })

  it('renders a custom label via props', () => {
    setLinkStatus('reconnecting')
    render(<GraphQLLinkStatusIndicator reconnectingLabel="Reconnexion en cours" />)
    const element = screen.getByTestId('statusbar-graphql-link-status')
    expect(element.querySelector('[aria-label]')?.getAttribute('aria-label')).toBe('Reconnexion en cours')
  })
})
