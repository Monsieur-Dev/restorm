import React, { useCallback } from 'react'
import { useSetting } from '../../hooks/useSettings'
import { Console } from './Console'
import { ConsoleToolbar } from './ConsoleToolbar'
import { useConsoleFeed } from './useConsoleFeed'
import type { ConsoleRecord, ConsoleShell } from './types'

export interface ConsolePanelProps {
  /** Click-through hook for log lines; receives the originating
   * record so the host can focus / open the source request. */
  onLineClick?: (record: ConsoleRecord) => void
  'data-testid'?: string
}

/**
 * Workbench-tab-ready Console surface: toolbar + xterm panel +
 * audit-feed subscription. The feed is sourced from whatever the
 * host wired via `registerConsoleFeedSource`.
 *
 * Settings:
 * - `console:requestFormat` — controls the curl ↔ powershell
 *   default at panel mount; the toolbar toggle persists changes
 *   back to the same key so the choice survives across restarts.
 */
export const ConsolePanel: React.FC<ConsolePanelProps> = ({
  onLineClick,
  'data-testid': dataTestId
}) => {
  // Persisted shell choice: host-level setting, falls back to curl
  // when undefined (first run). Toggle changes write back to the
  // same key so the next session picks them up.
  const [persistedFormat, setPersistedFormat] = useSetting('console:requestFormat')
  const shell: ConsoleShell = persistedFormat === 'powershell' ? 'powershell' : 'curl'
  const handleShellChange = useCallback((next: ConsoleShell): void => {
    void setPersistedFormat(next)
  }, [setPersistedFormat])
  const { records, clear } = useConsoleFeed()
  return (
    <div
      data-testid={dataTestId ?? 'console-panel'}
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        minHeight: 0
      }}
    >
      <ConsoleToolbar
        shell={shell}
        onShellChange={handleShellChange}
        onClear={clear}
      />
      {/* xterm renders its own scrollback inside the terminal
       * canvas; wrapping it in a ScrollableElement creates a
       * second scrollbar. The xterm-viewport's own bar is styled
       * via the companion stylesheet so the only visible scroll is
       * xterm's native one driven by the FitAddon-sized viewport. */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <Console records={records} shell={shell} {...(onLineClick ? { onLineClick } : {})} />
      </div>
    </div>
  )
}
