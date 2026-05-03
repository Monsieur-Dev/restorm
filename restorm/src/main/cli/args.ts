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
   * Whether to start the embedded MCP server. When true, restorm picks
   * a free port at boot and announces it via the discovery file (see
   * `mcpDiscoveryFile`) plus the per-pid lockfile in the central dir.
   * Falsy → no MCP listener at all.
   */
  mcpEnabled: boolean
  /**
   * Optional path the launcher requested restorm to write its chosen
   * MCP port to (in addition to the per-pid lockfile). The launcher
   * polls this exact file after spawning restorm so it can resolve
   * the new instance's port without scanning the dir.
   */
  mcpDiscoveryFile?: string
}

interface ParsedArgs {
  open?: string
  clearSettings?: boolean
  mcp?: boolean
  mcpDiscoveryFile?: string
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
    .option('mcp', {
      type: 'boolean',
      default: false,
      describe: 'Start the embedded MCP server (loopback only) on a free OS-picked port. Omit to keep MCP off.'
    })
    .option('mcp-discovery-file', {
      type: 'string',
      describe: 'Internal: written-to by restorm with `{port,projectPath,pid,startedAt}` once the MCP server is up. The MCP launcher passes this so it can poll a known file after spawning restorm.'
    })
    .help('help')
    .alias('help', 'h')
    .version(app.getVersion())
    .alias('version', 'v')
    .parseSync() as ArgumentsCamelCase<ParsedArgs>

  // CLI flag wins; env var (`ECUI_MCP=1`) is the lower-priority
  // fallback so consumers can flip MCP on without changing argv.
  const envEnabled = process.env['ECUI_MCP'] === '1' || process.env['ECUI_MCP'] === 'true'
  const mcpEnabled = Boolean(argv.mcp) || envEnabled

  const result: CliArgs = {
    clearSettings: Boolean(argv.clearSettings),
    mcpEnabled
  }
  if (argv.open !== undefined) result.open = argv.open
  if (typeof argv.mcpDiscoveryFile === 'string' && argv.mcpDiscoveryFile.length > 0) {
    result.mcpDiscoveryFile = argv.mcpDiscoveryFile
  }
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
