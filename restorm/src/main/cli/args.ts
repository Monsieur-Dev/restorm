import { app } from 'electron'
import { existsSync, rmSync } from 'fs'
import { join } from 'path'
import { logger } from 'electron-core-ui'
import yargs from 'yargs'
import type { ArgumentsCamelCase } from 'yargs'

export interface CliArgs {
  open?: string
  clearSettings: boolean
}

interface ParsedArgs {
  open?: string
  clearSettings?: boolean
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
    .help('help')
    .alias('help', 'h')
    .version(app.getVersion())
    .alias('version', 'v')
    .parseSync() as ArgumentsCamelCase<ParsedArgs>

  return {
    open: argv.open,
    clearSettings: Boolean(argv.clearSettings)
  }
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
