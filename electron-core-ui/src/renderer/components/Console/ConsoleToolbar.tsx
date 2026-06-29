import React from 'react'
import { Button } from '../Button'
import type { ConsoleShell } from './types'

export interface ConsoleToolbarProps {
  shell: ConsoleShell
  onShellChange: (next: ConsoleShell) => void
  onClear: () => void
  'data-testid'?: string
}

/**
 * Toolbar above the xterm panel: 2-state shell toggle (curl /
 * powershell) + a Clear button. The toggle is global — flipping
 * it re-renders the entire scrollback in the new format. Clear
 * empties the in-memory buffer; subsequent records start fresh.
 */
export const ConsoleToolbar: React.FC<ConsoleToolbarProps> = ({
  shell,
  onShellChange,
  onClear,
  'data-testid': dataTestId
}) => {
  const isPS = shell === 'powershell'
  return (
    <div
      data-testid={dataTestId ?? 'console-toolbar'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 8px',
        borderBottom: '1px solid var(--panel-border, rgba(127, 127, 127, 0.18))',
        flex: '0 0 auto'
      }}
    >
      <div
        role="radiogroup"
        aria-label="Shell flavor"
        style={{ display: 'inline-flex', borderRadius: 4, overflow: 'hidden', border: '1px solid var(--button-background, #2c4156)' }}
      >
        <Button
          role="radio"
          aria-checked={!isPS}
          data-testid="console-toolbar-shell-curl"
          onClick={() => { onShellChange('curl') }}
          style={{
            padding: '2px 10px',
            background: !isPS ? 'var(--button-background, #2c4156)' : 'transparent',
            color: !isPS ? 'var(--button-foreground, #fff)' : 'var(--editor-foreground)',
            fontSize: 12
          }}
        >curl</Button>
        <Button
          role="radio"
          aria-checked={isPS}
          data-testid="console-toolbar-shell-powershell"
          onClick={() => { onShellChange('powershell') }}
          style={{
            padding: '2px 10px',
            background: isPS ? 'var(--button-background, #2c4156)' : 'transparent',
            color: isPS ? 'var(--button-foreground, #fff)' : 'var(--editor-foreground)',
            borderLeft: '1px solid var(--button-background, #2c4156)',
            fontSize: 12
          }}
        >powershell</Button>
      </div>
      <div style={{ flex: 1 }} />
      <Button
        icon="clear-all"
        options={{ ariaLabel: 'Clear console', title: 'Clear console' }}
        data-testid="console-toolbar-clear"
        onClick={onClear}
        secondary
        small
      />
    </div>
  )
}
