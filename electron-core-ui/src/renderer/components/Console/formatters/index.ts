import type { ConsoleRecord, ConsoleShell } from '../types'
import { renderCurl } from './curl'
import { renderPowershell } from './powershell'

/**
 * Render a `ConsoleRecord` as a shell command string. Picks between
 * the curl and PowerShell renderers based on the user-controlled
 * shell flavour; each renderer dispatches further by `protocol`.
 *
 * No ANSI escape codes here — colourisation is applied by the
 * console once the command lines are merged into the xterm buffer
 * (verbs / status codes / comments coloured per record metadata,
 * not by re-tokenising the rendered command).
 */
export function renderRecord(record: ConsoleRecord, shell: ConsoleShell): string {
  return shell === 'powershell' ? renderPowershell(record) : renderCurl(record)
}
