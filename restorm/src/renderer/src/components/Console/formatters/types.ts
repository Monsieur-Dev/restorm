import type { RequestRecord } from '../../../../../shared/types/firewall'

/**
 * Shell flavor the user picked from the console toolbar. Drives
 * which renderer is selected for each `RequestRecord`. The toggle
 * is global — flipping it re-renders the entire scrollback.
 */
export type ConsoleShell = 'curl' | 'powershell'

/**
 * One renderer per `(protocol × shell)` pair. The function returns
 * the multi-line shell command the user can copy / replay; ANSI
 * escape codes for colourisation are added by the consumer
 * (`Console.tsx`) once protocols are merged into a single buffer.
 */
export type RecordRenderer = (record: RequestRecord) => string
