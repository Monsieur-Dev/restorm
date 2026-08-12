import { app } from 'electron'
import { execFileSync } from 'node:child_process'
import { existsSync, rmSync } from 'fs'
import { basename, join } from 'path'
import { logger, generateUniqueSessionName, readAllInstancesIncludingCut, resolveMcpDiscoveryDir } from 'electron-core-ui'
import yargs from 'yargs'
import type { ArgumentsCamelCase } from 'yargs'

/**
 * Headless scenario-run request, present iff `--run` was passed. Triggers
 * CLI-run mode: restorm loads `--open`, executes the named scenario through the
 * real engine (in the main process, no renderer required), streams its run-log,
 * and exits with a status code reflecting the scenario outcome.
 */
export interface CliRunOptions {
  /** Scenario to run — its long name (default) or its id. */
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
   * Start on a new, empty file. Carried by the application-icon menu's "new"
   * entry on the platforms that relaunch the app instead of calling back into
   * it (Windows jump lists), where the single-instance lock turns the relaunch
   * into a `second-instance` event on the running process.
   */
  newFile: boolean
  /**
   * Human-readable name identifying this MCP session. Always set (a
   * sensible auto-default is derived when neither `--mcp-session-name`
   * nor `RESTORM_MCP_SESSION_NAME` is given) so every instance is
   * addressable by name through the cross-instance bridge. The name is
   * written into the per-pid lockfile and matched verbatim when a
   * `tools/call` carries a `__session` routing key.
   */
  mcpSessionName: string
  /**
   * Optional path the launcher requested restorm to write its chosen
   * MCP port to (in addition to the per-pid lockfile). The launcher
   * polls this exact file after spawning restorm so it can resolve
   * the new instance's port without scanning the dir.
   */
  mcpDiscoveryFile?: string
  /**
   * Reveal the main window without taking OS focus. When true the window
   * appears via `showInactive()` (visible — so automation/MCP screenshots
   * still work — but NOT focused, activated, raised, or desktop-switching)
   * instead of the focusing `show()`. Set it for programmatically-launched
   * instances (the `dev:restorm:mcp` launcher's instances, e2e/agent windows)
   * so they don't steal the user's focus. Defaults to false — the user's normal
   * launch focuses as usual. The flag is handled in electron-core-ui's window
   * manager.
   */
  inactiveWindow: boolean
  /** Set when `--run` was passed — see {@link CliRunOptions}. */
  cliRun?: CliRunOptions
}

interface ParsedArgs {
  open?: string
  clearSettings?: boolean
  new?: boolean
  mcpSessionName?: string
  mcpDiscoveryFile?: string
  inactiveWindow?: boolean
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
      describe: 'Path to a .restorm project file to open on start'
    })
    .option('clear-settings', {
      alias: 'cls',
      type: 'boolean',
      default: false,
      describe: 'Clear user preferences before starting'
    })
    .option('new', {
      type: 'boolean',
      default: false,
      describe: 'Start on a new, empty file. Passed by the application-icon menu on platforms whose entries relaunch the app (Windows jump lists).'
    })
    .option('mcp-session-name', {
      type: 'string',
      describe: 'Human-readable name for this MCP session (e.g. a ticket name). Written into the lockfile and matched verbatim when a tool call targets a specific instance via the `__session` routing key. Defaults to a stable auto name when omitted (env: RESTORM_MCP_SESSION_NAME).'
    })
    .option('mcp-discovery-file', {
      type: 'string',
      describe: 'Internal: written-to by restorm with `{port,projectPath,pid,startedAt}` once the MCP server is up. The MCP launcher passes this so it can poll a known file after spawning restorm.'
    })
    .option('inactive-window', {
      type: 'boolean',
      default: false,
      describe: 'Reveal the main window without taking OS focus (showInactive): visible — so MCP screenshots/automation still work — but NOT focused, activated, raised, or desktop-switching. For programmatic launches (the dev:restorm:mcp launcher, e2e/agent windows) so they don\'t steal the user\'s focus. Omit it for the normal focusing launch.'
    })
    .option('run', {
      type: 'string',
      describe: 'Headless: run the named scenario from the project given by --open, stream its run-log, and exit (0 = success, non-zero = failure). Designate the scenario by its name (default) or its id (--by id).'
    })
    .option('by', {
      type: 'string',
      choices: ['name', 'id'],
      default: 'name',
      describe: 'How --run designates the scenario: by name (default) or by id.'
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

  // MCP is governed entirely by the user-facing `mcp:enabled` setting
  // (default ON) plus the headless rule (no usable display → never start) —
  // see index.ts. There is no longer any CLI flag or env var to toggle it.
  const result: CliArgs = {
    clearSettings: Boolean(argv.clearSettings),
    newFile: Boolean(argv.new),
    mcpSessionName: resolveMcpSessionName(argv.mcpSessionName, argv.open),
    inactiveWindow: Boolean(argv.inactiveWindow)
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

/**
 * Resolve the MCP session name with a stable fallback so every instance
 * always has one. Precedence:
 *   1. `--mcp-session-name` flag (verbatim)
 *   2. `RESTORM_MCP_SESSION_NAME` env var (verbatim)
 *   3. A name derived from the `--open` target's basename, pid-suffixed so two
 *      instances opening the same file stay distinct.
 *   4. A friendly random adjective-animal pair (e.g. `lucky-unicorn`), unique
 *      across currently live instances; in DEV mode the worktree basename is
 *      appended as `<name>@<worktree>` for developer convenience.
 *
 * The name is matched verbatim by the cross-instance bridge, so human-readable
 * strings (spaces, @ signs) are fine. Exported for unit testing.
 *
 * The optional `_resolveWorktreeBasename` parameter is injectable for tests: in
 * production the default reads the git toplevel via `execFileSync`.
 */
function defaultResolveWorktreeBasename(): string {
  try {
    const toplevel = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
    return basename(toplevel)
  } catch {
    return basename(process.cwd())
  }
}

export function resolveMcpSessionName(
  flagValue: string | undefined,
  openTarget: string | undefined,
  _resolveWorktreeBasename: () => string = defaultResolveWorktreeBasename
): string {
  const flag = flagValue?.trim()
  if (flag !== undefined && flag !== '') return flag
  const env = process.env['RESTORM_MCP_SESSION_NAME']?.trim()
  if (env !== undefined && env !== '') return env
  const open = openTarget?.trim()
  if (open !== undefined && open !== '') {
    // Strip directory + a trailing `.restorm`/other extension so the
    // name reads like the project, not its path.
    const base = open.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
    const withoutExt = base.replace(/\.[^.]+$/, '')
    const cleaned = (withoutExt || base).trim()
    // Append the pid so two instances opening the SAME file still get distinct,
    // verbatim-matchable names (an explicit --mcp-session-name / env overrides
    // this entirely when the user wants a fixed readable name).
    if (cleaned !== '') return `restorm:${cleaned} (${String(process.pid)})`
  }
  // No project to name after — generate a friendly random adjective-animal name
  // and ensure it does not clash with any currently live instance.
  const isDev = process.env['NODE_ENV'] === 'development' || !app.isPackaged
  const discoveryDir = resolveMcpDiscoveryDir('restorm-mcp', process.env['RESTORM_MCP_DIR'])
  const existingNames = readAllInstancesIncludingCut(discoveryDir).map((i) => i.name)
  // In DEV, append the worktree's root directory name so simultaneous
  // per-worktree instances are visually distinct. Use `git rev-parse
  // --show-toplevel` (not `process.cwd()`) because the canonical launch
  // `pnpm dev:restorm` runs with cwd = the restorm sub-package dir, which
  // is the same for every worktree; git always returns the worktree root.
  const worktreeSuffix = isDev ? _resolveWorktreeBasename() : undefined
  return generateUniqueSessionName(existingNames, worktreeSuffix)
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
