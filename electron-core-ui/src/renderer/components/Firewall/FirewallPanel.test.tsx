// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'
import { FirewallPanel } from './FirewallPanel'
import type { FirewallOrigin } from '../../../types/firewall'

// i18n is mocked to return each call's default copy, so assertions read like the
// panel rather than depending on a loaded bundle.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key })
}))

// jsdom ships no ResizeObserver; the panel's ScrollableElement root installs one
// on mount. Stubbed rather than mocking the primitive away, so the real
// scrollable stays in the tree under test.
globalThis.ResizeObserver = class {
  observe(): void { /* no layout in jsdom */ }
  unobserve(): void { /* no-op */ }
  disconnect(): void { /* no-op */ }
} as unknown as typeof ResizeObserver

/**
 * Stand-in for `window.api.firewall`, backed by two arrays the test can inspect.
 * The mutators write through, so an add / remove is asserted on what the panel
 * shows AFTER the round-trip rather than on the call alone.
 */
function installFirewallApi(): {
  whitelist: FirewallOrigin[]
  blacklist: FirewallOrigin[]
  addToWhitelist: ReturnType<typeof vi.fn>
  removeFromWhitelist: ReturnType<typeof vi.fn>
  addToBlacklist: ReturnType<typeof vi.fn>
  removeFromBlacklist: ReturnType<typeof vi.fn>
} {
  const whitelist: FirewallOrigin[] = []
  const blacklist: FirewallOrigin[] = []
  const drop = (list: FirewallOrigin[], o: FirewallOrigin): void => {
    const i = list.findIndex((x) => x.host === o.host && x.port === o.port && x.scheme === o.scheme)
    if (i >= 0) list.splice(i, 1)
  }
  const addToWhitelist = vi.fn((o: FirewallOrigin) => { whitelist.push(o); return Promise.resolve() })
  const removeFromWhitelist = vi.fn((o: FirewallOrigin) => { drop(whitelist, o); return Promise.resolve() })
  const addToBlacklist = vi.fn((o: FirewallOrigin) => { blacklist.push(o); return Promise.resolve() })
  const removeFromBlacklist = vi.fn((o: FirewallOrigin) => { drop(blacklist, o); return Promise.resolve() })
  const firewall = {
    listWhitelist: (): Promise<FirewallOrigin[]> => Promise.resolve(whitelist.slice()),
    listBlacklist: (): Promise<FirewallOrigin[]> => Promise.resolve(blacklist.slice()),
    addToWhitelist,
    removeFromWhitelist,
    addToBlacklist,
    removeFromBlacklist
  }
  ;(window as unknown as { api: { firewall: unknown } }).api = { firewall }
  return { whitelist, blacklist, addToWhitelist, removeFromWhitelist, addToBlacklist, removeFromBlacklist }
}

/** Mount and wait for the store's first read to settle (the panel renders a
 * loading placeholder until then). */
async function mountPanel(): Promise<void> {
  render(<FirewallPanel appName="Restorm" />)
  await screen.findByTestId('firewall-tabs')
}

/** The ECUI `InputBox` puts the real `<input>` one level below the testid it is
 * given, and the ECUI `Button` is not a native `<button>` — it carries its
 * disabled state on `aria-disabled`. Both helpers keep that plumbing in one
 * place instead of scattering it through the assertions. */
function originInput(prefix: string): HTMLElement {
  return screen.getByTestId(`${prefix}-input-input`)
}

function isDisabled(el: HTMLElement): boolean {
  return el.getAttribute('aria-disabled') === 'true'
}

beforeEach(() => { installFirewallApi() })
afterEach(() => { cleanup() })

describe('FirewallPanel', () => {
  it('renders the header and the Whitelist / Blacklist tabs', async () => {
    await mountPanel()
    expect(screen.getByTestId('firewall-panel')).not.toBeNull()
    expect(screen.getByText('Firewall')).not.toBeNull()
    // The app name is interpolated into the intro rather than baked in.
    expect(screen.getByTestId('firewall-panel').textContent).toContain('Restorm')
    expect(screen.getByText('Whitelist (0)')).not.toBeNull()
    expect(screen.getByText('Blacklist (0)')).not.toBeNull()
  })

  // The app's own outbound destinations stay declared and enforced main-side,
  // but the panel deliberately does not display them: it holds the lists the
  // user acts on. These two guards keep the removed surfaces from creeping back.
  it('does not render an outbound-services section', async () => {
    await mountPanel()
    expect(screen.queryByTestId('firewall-outbound')).toBeNull()
    expect(screen.queryByTestId('firewall-outbound-empty')).toBeNull()
    expect(screen.getByTestId('firewall-panel').textContent).not.toContain('Outbound services')
  })

  it('does not render a test-outbound button', async () => {
    await mountPanel()
    expect(screen.queryByTestId('firewall-test-outbound')).toBeNull()
    expect(screen.getByTestId('firewall-panel').textContent).not.toContain('google.com')
  })

  it('adds a whitelist entry and shows it, normalising the origin', async () => {
    const api = installFirewallApi()
    await mountPanel()
    fireEvent.change(originInput('firewall-whitelist'), {
      target: { value: 'https://api.example.com' }
    })
    fireEvent.click(screen.getByTestId('firewall-whitelist-add'))
    await waitFor(() => {
      expect(api.addToWhitelist).toHaveBeenCalledWith({ scheme: 'https', host: 'api.example.com', port: 443 })
    })
    // The default port is elided again on display.
    await screen.findByTestId('firewall-whitelist-row-https://api.example.com')
  })

  it('removes a whitelist entry through the trash button', async () => {
    const api = installFirewallApi()
    api.whitelist.push({ scheme: 'https', host: 'api.example.com', port: 443 })
    await mountPanel()
    const row = await screen.findByTestId('firewall-whitelist-remove-https://api.example.com')
    fireEvent.click(row)
    await waitFor(() => {
      expect(api.removeFromWhitelist).toHaveBeenCalledWith({ scheme: 'https', host: 'api.example.com', port: 443 })
    })
    await waitFor(() => {
      expect(screen.queryByTestId('firewall-whitelist-row-https://api.example.com')).toBeNull()
    })
  })

  it('adds and removes a blacklist entry from the Blacklist tab', async () => {
    const api = installFirewallApi()
    await mountPanel()
    fireEvent.click(screen.getByText('Blacklist (0)'))
    fireEvent.change(originInput('firewall-blacklist'), {
      target: { value: 'https://tracker.example.com' }
    })
    fireEvent.click(screen.getByTestId('firewall-blacklist-add'))
    await waitFor(() => {
      expect(api.addToBlacklist).toHaveBeenCalledWith({ scheme: 'https', host: 'tracker.example.com', port: 443 })
    })
    const remove = await screen.findByTestId('firewall-blacklist-remove-https://tracker.example.com')
    fireEvent.click(remove)
    await waitFor(() => {
      expect(api.removeFromBlacklist).toHaveBeenCalledWith({ scheme: 'https', host: 'tracker.example.com', port: 443 })
    })
  })

  it('keeps the Add button disabled until the draft parses as an origin', async () => {
    await mountPanel()
    const add = screen.getByTestId('firewall-whitelist-add')
    expect(isDisabled(add)).toBe(true)
    // A `*` outside the leading `*.` form must not parse — otherwise it would
    // persist as a string-literal host that never matches anything.
    fireEvent.change(originInput('firewall-whitelist'), { target: { value: 'https://*bad' } })
    await waitFor(() => { expect(isDisabled(add)).toBe(true) })
    fireEvent.change(originInput('firewall-whitelist'), { target: { value: 'https://ok.example.com' } })
    await waitFor(() => { expect(isDisabled(add)).toBe(false) })
  })
})
