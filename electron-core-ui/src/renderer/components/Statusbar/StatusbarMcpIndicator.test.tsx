// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { StatusbarMcpIndicator } from './StatusbarMcpIndicator'

// i18n is mocked to echo the key so assertions don't depend on a loaded bundle.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

afterEach(() => { cleanup() })

/** Open the click-popover (its content renders in a portal on the body). */
function openPopover(): void {
  fireEvent.click(screen.getByTestId('statusbar-mcp-indicator'))
}

describe('StatusbarMcpIndicator — always present, even when the server is stopped', () => {
  it('renders the indicator when the server is STOPPED (running=false)', () => {
    const { container } = render(
      <StatusbarMcpIndicator port={null} running={false} onToggleServer={vi.fn()} onViewLogs={vi.fn()} />
    )
    // The indicator itself must be present — it no longer disappears when the
    // server is off (the stopped-but-re-enablable case).
    expect(screen.getByTestId('statusbar-mcp-indicator')).toBeTruthy()
    // ...and it carries the stopped marker class.
    expect(container.querySelector('.mcp-stopped')).not.toBeNull()
  })

  it('stopped popover shows the ENABLE/resume button AND the logs button', () => {
    const onToggleServer = vi.fn()
    const onViewLogs = vi.fn()
    render(
      <StatusbarMcpIndicator port={null} running={false} onToggleServer={onToggleServer} onViewLogs={onViewLogs} />
    )
    openPopover()

    const toggle = screen.getByTestId('statusbar-mcp-toggle-server')
    const logs = screen.getByTestId('statusbar-mcp-view-logs')
    // The stopped state offers to bring the server UP (resume/enable).
    expect(toggle.textContent).toContain('statusbar.mcp.resumeServer')

    fireEvent.click(toggle)
    expect(onToggleServer).toHaveBeenCalledTimes(1)
    fireEvent.click(logs)
    expect(onViewLogs).toHaveBeenCalledTimes(1)
  })

  it('running popover shows the STOP button + the logs button', () => {
    render(
      <StatusbarMcpIndicator port={39000} running onToggleServer={vi.fn()} onViewLogs={vi.fn()} />
    )
    openPopover()

    expect(screen.getByTestId('statusbar-mcp-toggle-server').textContent).toContain('statusbar.mcp.stopServer')
    expect(screen.getByTestId('statusbar-mcp-view-logs')).toBeTruthy()
  })

  it('the logs button is present even with NO toggle wired (logs always available)', () => {
    render(
      <StatusbarMcpIndicator port={null} running={false} onViewLogs={vi.fn()} />
    )
    openPopover()
    expect(screen.getByTestId('statusbar-mcp-view-logs')).toBeTruthy()
  })

  // `rightAligned` must apply the `right-aligned` (margin-left: auto) class in
  // EVERY state — the indicator always renders, so it always owns the statusbar's
  // right-side auto margin. A regression here left the stopped indicator unaligned
  // (rendered centred instead of next to the bell on the right).
  it('rightAligned applies the right-aligned class when RUNNING', () => {
    render(<StatusbarMcpIndicator port={39000} running rightAligned />)
    expect(screen.getByTestId('statusbar-mcp-indicator').classList.contains('right-aligned')).toBe(true)
  })

  it('rightAligned applies the right-aligned class when STOPPED', () => {
    render(<StatusbarMcpIndicator port={null} running={false} rightAligned onToggleServer={vi.fn()} />)
    const el = screen.getByTestId('statusbar-mcp-indicator')
    expect(el.classList.contains('right-aligned')).toBe(true)
    // ...and stays marked stopped without losing the alignment.
    expect(el.classList.contains('mcp-stopped')).toBe(true)
  })
})

describe('StatusbarMcpIndicator — Pro upsell (non-blocking)', () => {
  it('shows the upsell note + link when proUpsell is provided, and does NOT gate the toggle', () => {
    const onUpgrade = vi.fn()
    render(
      <StatusbarMcpIndicator
        port={39000}
        running
        onToggleServer={vi.fn()}
        proUpsell={{ note: 'agents drive requests; pro for more', linkLabel: 'Upgrade to Pro', onUpgrade }}
      />
    )
    openPopover()

    expect(screen.getByTestId('statusbar-mcp-pro-upsell').textContent).toContain('agents drive requests')
    // The server toggle stays present + usable — the upsell never locks MCP.
    expect(screen.getByTestId('statusbar-mcp-toggle-server')).toBeTruthy()

    fireEvent.click(screen.getByTestId('statusbar-mcp-pro-upsell-link'))
    expect(onUpgrade).toHaveBeenCalledTimes(1)
  })

  it('renders NO upsell when proUpsell is omitted (the entitled case)', () => {
    render(<StatusbarMcpIndicator port={39000} running onToggleServer={vi.fn()} />)
    openPopover()
    expect(screen.queryByTestId('statusbar-mcp-pro-upsell')).toBeNull()
  })
})
