/**
 * Service for importing curl commands into Restorm collections
 * 
 * Supports:
 * - Multiple commands separated by blank lines
 * - All HTTP methods (-X GET, POST, etc.)
 * - Headers (-H, --header)
 * - Body data (-d, --data, --data-raw, --data-binary)
 * - URL parameters
 * - Form data (--form, -F)
 */

import {
  EnvironmentFolder,
  HTTPRequest
} from '../../../shared/models'
import { parseCurlCommand } from '../../../shared/utils/parseCurlCommand'

/** Split input into multiple curl commands */
function splitCurlCommands(input: string): string[] {
  // Split by double newlines (blank lines) or by 'curl' keyword at start of line
  const commands: string[] = []
  const lines = input.split('\n')
  let currentCommand = ''
  
  for (const line of lines) {
    if (line.trim().startsWith('curl ') && currentCommand.trim()) {
      // New command starting
      commands.push(currentCommand.trim())
      currentCommand = line
    } else {
      currentCommand += '\n' + line
    }
  }
  
  if (currentCommand.trim()) {
    commands.push(currentCommand.trim())
  }
  
  return commands.filter(cmd => cmd.startsWith('curl'))
}

// ============================================================================
// Export Function
// ============================================================================

/**
 * Import curl commands into a Restorm EnvironmentFolder
 * @param curlInput - One or more curl commands (separated by blank lines)
 * @param options - Import options
 * @returns EnvironmentFolder containing the imported requests
 */
export function importCurl(
  curlInput: string,
  options: { folderName?: string } = {}
): EnvironmentFolder {
  const commands = splitCurlCommands(curlInput)
  const requests: HTTPRequest[] = []

  for (const command of commands) {
    const parsed = parseCurlCommand(command)
    if (parsed) {
      // Promote the plain parsed shape to a real `HTTPRequest` instance so
      // KeyValue arrays carry `KeyValue` class instances (not plain
      // objects) — downstream collection code relies on that.
      requests.push(new HTTPRequest(parsed))
    }
  }

  const folder = new EnvironmentFolder({
    name: options.folderName ?? 'cURL Imports',
    tags: ['curl'],
    items: requests,
    environments: []
  })

  return folder
}
