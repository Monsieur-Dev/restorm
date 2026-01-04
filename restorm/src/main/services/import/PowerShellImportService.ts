/**
 * Service for importing PowerShell Invoke-RestMethod and Invoke-WebRequest commands
 * 
 * Supports:
 * - Multiple commands separated by blank lines
 * - Invoke-RestMethod and Invoke-WebRequest
 * - All HTTP methods (-Method GET, POST, etc.)
 * - Headers (-Headers @{...})
 * - Body (-Body)
 * - ContentType (-ContentType)
 * - URI (-Uri)
 */

import {
  EnvironmentFolder,
  HTTPRequest,
  type HTTPMethod,
  type HTTPRequestBody,
  type KeyValue
} from '../../../shared/models'
import { logger } from 'electron-core-ui/main'

// ============================================================================
// Helper Functions
// ============================================================================

/** Generate a unique ID */
function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(7)}`
}

/** Parse a PowerShell hashtable string into key-value pairs */
function parseHashtable(hashtableStr: string): KeyValue[] {
  const result: KeyValue[] = []
  
  // Remove @{ and }
  const content = hashtableStr.replace(/^@?\{/, '').replace(/\}$/, '').trim()
  
  // Split by ; or newline, handling quoted values
  const pairs = content.split(/[;\n]/).map(p => p.trim()).filter(Boolean)
  
  for (const pair of pairs) {
    const match = /^["']?(\w+)["']?\s*=\s*["']?(.*)["']?$/.exec(pair)
    if (match) {
      const key = match[1]
      let value = match[2].trim()
      // Remove surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) || 
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      result.push({
        key,
        value,
        enabled: true
      })
    }
  }
  
  return result
}

/** Parse a PowerShell command into an HTTPRequest */
function parsePowerShellCommand(psCommand: string): HTTPRequest | null {
  try {
    // Normalize the command (remove line breaks with backticks)
    const normalized = psCommand.replace(/`\s*\n\s*/g, ' ').trim()
    
    if (!(/Invoke-(RestMethod|WebRequest)/.exec(normalized))) {
      return null
    }

    // Extract URI
    let url = ''
    const uriMatch = /-Uri\s+["']([^"']+)["']/.exec(normalized)
    if (uriMatch) {
      url = uriMatch[1]
    } else {
      // Try without quotes
      const uriMatch2 = /-Uri\s+([^\s]+)/.exec(normalized)
      if (uriMatch2) {
        url = uriMatch2[1]
      }
    }

    if (!url) {
      return null
    }

    // Extract method
    let method: HTTPMethod = 'GET'
    const methodMatch = /-Method\s+["']?(\w+)["']?/.exec(normalized)
    if (methodMatch) {
      method = methodMatch[1].toUpperCase() as HTTPMethod
    }

    // Extract headers
    const headers: KeyValue[] = []
    const headersMatch = /-Headers\s+(@?\{[^}]+\})/.exec(normalized)
    if (headersMatch) {
      headers.push(...parseHashtable(headersMatch[1]))
    }

    // Extract ContentType
    const contentTypeMatch = /-ContentType\s+["']([^"']+)["']/.exec(normalized)
    if (contentTypeMatch && !headers.some(h => h.key.toLowerCase() === 'content-type')) {
      headers.push({
        key: 'Content-Type',
        value: contentTypeMatch[1],
        enabled: true
      })
    }

    // Extract body
    let body: HTTPRequestBody | undefined
    const bodyMatch = /-Body\s+["']([^"']+)["']/.exec(normalized)
    if (bodyMatch) {
      body = {
        type: 'text',
        content: bodyMatch[1].replace(/\\"/g, '"')
      }
    } else {
      // Try multi-line body with @' or @"
      const multilineBodyMatch = /-Body\s+@["']([^@]*)["']@/.exec(normalized)
      if (multilineBodyMatch) {
        body = {
          type: 'text',
          content: multilineBodyMatch[1].trim()
        }
      }
    }

    // Parse URL to extract query params
    const urlObj = new URL(url)
    const params: KeyValue[] = []
    urlObj.searchParams.forEach((value, key) => {
      params.push({
        key,
        value,
        enabled: true
      })
    })

    // Generate request name from URL
    const pathname = urlObj.pathname || '/'
    const name = `${method} ${pathname}`

    const request: HTTPRequest = {
      id: generateId('powershell'),
      name,
      type: 'http',
      method,
      url: urlObj.origin + urlObj.pathname,
      headers,
      params,
      body,
      documentation: `Imported from PowerShell command`,
      tags: ['powershell-import']
    }

    return request
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    logger.error('[PowerShellImportService] Error parsing PowerShell command', { message: errorMessage })
    return null
  }
}

/** Split input into multiple PowerShell commands */
function splitPowerShellCommands(input: string): string[] {
  const commands: string[] = []
  const lines = input.split('\n')
  let currentCommand = ''
  
  for (const line of lines) {
    if ((/^Invoke-(RestMethod|WebRequest)/.exec(line.trim())) && currentCommand.trim()) {
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
  
  return commands.filter(cmd => /Invoke-(RestMethod|WebRequest)/.exec(cmd))
}

// ============================================================================
// Export Function
// ============================================================================

/**
 * Import PowerShell Invoke-RestMethod/Invoke-WebRequest commands into a Restorm EnvironmentFolder
 * @param psInput - One or more PowerShell commands (separated by blank lines)
 * @param options - Import options
 * @returns EnvironmentFolder containing the imported requests
 */
export function importPowerShell(
  psInput: string,
  options: { folderName?: string } = {}
): EnvironmentFolder {
  const commands = splitPowerShellCommands(psInput)
  const requests: HTTPRequest[] = []

  for (const command of commands) {
    const request = parsePowerShellCommand(command)
    if (request) {
      requests.push(request)
    }
  }

  const folder = new EnvironmentFolder({
    name: options.folderName ?? 'PowerShell Imports',
    documentation: `Imported from ${requests.length} PowerShell command(s)`,
    tags: ['powershell'],
    items: requests,
    environments: []
  })

  return folder
}
