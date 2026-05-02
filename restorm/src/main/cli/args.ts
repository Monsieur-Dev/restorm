import { app } from 'electron'
import { existsSync, rmSync } from 'fs'
import { join } from 'path'
import { logger } from 'electron-core-ui'
import yargs from 'yargs'
import type { ArgumentsCamelCase } from 'yargs'

export interface CliArgs {
  open?: string
  clearSettings: boolean
  /**
   * Port for the embedded MCP server. `0` (or absent flag + absent
   * env var) means "MCP off" — ECUI's `McpService.start()` treats
   * that as a sentinel and never opens a listener. CLI flag wins
   * over the `ECUI_MCP_PORT` env var.
   */
  mcpPort: number
}

interface ParsedArgs {
  open?: string
  clearSettings?: boolean
  mcpPort?: number
}

function getRawArgs(): string[] {
  return process.argv.slice(app.isPackaged ? 1 : 2)
}

export function parseCliArgs(): CliArgs {
  const argv = yargs<ParsedArgs>(getRawArgs())
    .usage('Usage: $0 [options]')
    .option('open', {
      alias: 'o',
      type: 'string',
      describe: 'Path to a file or folder to open on start'
    })
    .option('clear-settings', {
      alias: 'cls',
      type: 'boolean',
      default: false,
      describe: 'Clear user preferences before starting'
    })
    .option('mcp-port', {
      type: 'number',
      describe: 'Port for the embedded MCP server (loopback only). Omit / 0 to keep MCP off.'
    })
    .help('help')
    .alias('help', 'h')
    .version(app.getVersion())
    .alias('version', 'v')
    .parseSync() as ArgumentsCamelCase<ParsedArgs>

  // CLI flag wins; env var is the lower-priority fallback. Both
  // resolve to a non-negative integer or 0 (off).
  const envPort = parseInt(process.env['ECUI_MCP_PORT'] ?? '', 10)
  const cliPort = typeof argv.mcpPort === 'number' && Number.isFinite(argv.mcpPort)
    ? Math.trunc(argv.mcpPort)
    : null
  const resolvedPort = cliPort ?? (Number.isFinite(envPort) ? envPort : 0)
  const mcpPort = resolvedPort > 0 ? resolvedPort : 0

  const result: CliArgs = {
    clearSettings: Boolean(argv.clearSettings),
    mcpPort
  }
  if (argv.open !== undefined) result.open = argv.open
  return result
}

export function clearUserSettings(): void {
  const storagePath = join(app.getPath('userData'), 'config.json')

  if (!existsSync(storagePath)) {
    logger.info('No user settings file found to clear')
    return
  }

  try {
    rmSync(storagePath, { force: true })
    logger.info('User settings cleared', { path: storagePath })
  } catch (error) {
    logger.error('Failed to clear user settings', { error: String(error) })
  }
}
