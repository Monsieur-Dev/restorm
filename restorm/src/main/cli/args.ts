import { app } from 'electron'
import { existsSync, rmSync } from 'fs'
import { join } from 'path'
import { logger } from 'electron-core-ui'
import yargs from 'yargs'
import type { ArgumentsCamelCase } from 'yargs'

/**
 * Headless scenario-run request, present iff `--run` was passed. Triggers
 * CLI-run mode: restorm loads `--open`, executes the named scenario through the
 * real engine (in the main process, no renderer required), streams its run-log,
 * and exits with a status code reflecting the scenario outcome.
 */
export interface CliRunOptions {
  /** Scenario to run — its folder-mode long name (default) or its id. */
  target: string
  /** How to interpret {@link target}. */
  by: 'name' | 'id'
  /** `false` (default) = only user `Log` entries; `true` = every engine log. */
  verbose: boolean
  /** Optional file the run-log is appended to (tail) as entries arrive. */
  outFile?: string
  /** `true` = no window at all; `false` (default) = also show the window for
   * visual feedback while the run streams to the console. */
  headless: boolean
  /** Raw `--param name=value` strings, by name. Cast to each input's declared
   * type at apply time (see `coerceCliParamValue`); a param not supplied falls
   * back to that input's configured default. */
  params: Record<string, string>
}

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
  /** Set when `--run` was passed — see {@link CliRunOptions}. */
  cliRun?: CliRunOptions
}

interface ParsedArgs {
  open?: string
  clearSettings?: boolean
  mcp?: boolean
  mcpDiscoveryFile?: string
  run?: string
  by?: string
  allLogs?: boolean
  out?: string
  headless?: boolean
  param?: (string | number)[]
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
    .option('run', {
      type: 'string',
      describe: 'Headless: run the named scenario from the project given by --open, stream its run-log, and exit (0 = success, non-zero = failure). Designate the scenario by its folder-mode name (default) or its id (--by id).'
    })
    .option('by', {
      type: 'string',
      choices: ['name', 'id'],
      default: 'name',
      describe: 'How --run designates the scenario: by folder-mode name (default) or by id.'
    })
    .option('all-logs', {
      type: 'boolean',
      default: false,
      describe: 'With --run: include every engine/lifecycle log (default: only user `Log` action entries).'
    })
    .option('out', {
      type: 'string',
      describe: 'With --run: append the run-log to this file (tail, as entries arrive) in addition to the console.'
    })
    .option('headless', {
      type: 'boolean',
      default: false,
      describe: 'With --run: run without any window. Omit it to also show the window for visual feedback while the run streams to the console.'
    })
    .option('param', {
      type: 'array',
      describe: 'With --run: supply a scenario input value (repeatable), as `name=value`. The value is cast to the input\'s declared type (number/boolean/…; a list is JSON, e.g. Ids=[1,2,3]). A param not given uses that input\'s default.'
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
  if (typeof argv.run === 'string' && argv.run.length > 0) {
    const params: Record<string, string> = {}
    for (const entry of argv.param ?? []) {
      const str = String(entry)
      const eq = str.indexOf('=')
      // Accept `name=` (empty value) but reject a bare `name` with no `=`, and
      // `=value` with no name — those are almost always a typo. Warn rather
      // than silently dropping so a mistyped param doesn't masquerade as the
      // input's default.
      if (eq > 0) params[str.slice(0, eq)] = str.slice(eq + 1)
      else process.stderr.write(`Ignoring malformed --param '${str}' (expected name=value)\n`)
    }
    const cliRun: CliRunOptions = {
      target: argv.run,
      by: argv.by === 'id' ? 'id' : 'name',
      verbose: Boolean(argv.allLogs),
      headless: Boolean(argv.headless),
      params
    }
    if (typeof argv.out === 'string' && argv.out.length > 0) cliRun.outFile = argv.out
    result.cliRun = cliRun
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
