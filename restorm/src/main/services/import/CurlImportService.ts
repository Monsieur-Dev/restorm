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

/** Parse a curl command string into an HTTPRequest */
function parseCurlCommand(curlCommand: string): HTTPRequest | null {
  try {
    // Remove line continuations
    const normalized = curlCommand.replace(/\\\s*\n\s*/g, ' ').trim()
    
    if (!normalized.startsWith('curl')) {
      return null
    }

    // Extract URL (first argument that looks like a URL or after curl command)
    let url = ''
    const urlPattern = /curl\s+(?:-[^\s]+\s+)*['"]?(https?:\/\/[^\s'"]+)['"]?/
    const urlMatch = urlPattern.exec(normalized)
    if (urlMatch) {
      url = urlMatch[1]
    } else {
      // Try to find URL anywhere in the command
      const urlPattern2 = /(['"]?)(https?:\/\/[^\s'"]+)\1/
      const urlMatch2 = urlPattern2.exec(normalized)
      if (urlMatch2) {
        url = urlMatch2[2]
      }
    }

    if (!url) {
      return null
    }

    // Extract method (-X or --request)
    let method: HTTPMethod = 'GET'
    const methodPattern = /(?:-X|--request)\s+(['"]?)(\w+)\1/
    const methodMatch = methodPattern.exec(normalized)
    if (methodMatch) {
      method = methodMatch[2].toUpperCase() as HTTPMethod
    } else if (normalized.includes('-d ') || normalized.includes('--data')) {
      method = 'POST' // curl defaults to POST when -d is present
    }

    // Extract headers (-H or --header)
    const headers: KeyValue[] = []
    const headerRegex = /(?:-H|--header)\s+(['"])(.*?)\1/g
    let headerMatch
    while ((headerMatch = headerRegex.exec(normalized)) !== null) {
      const headerValue = headerMatch[2]
      const colonIndex = headerValue.indexOf(':')
      if (colonIndex > 0) {
        headers.push({
          key: headerValue.substring(0, colonIndex).trim(),
          value: headerValue.substring(colonIndex + 1).trim(),
          enabled: true
        })
      }
    }

    // Extract body data (-d, --data, --data-raw, --data-binary)
    let body: HTTPRequestBody | undefined
    const dataPattern = /(?:-d|--data|--data-raw|--data-binary)\s+(['"])((?:[^'"]|\\.)*)\1/
    const dataMatch = dataPattern.exec(normalized)
    if (dataMatch) {
      const bodyContent = dataMatch[2].replace(/\\"/g, '"').replace(/\\'/g, "'")
      body = {
        type: 'text',
        content: bodyContent
      }
    }

    // Extract form data (-F or --form)
    const formDataRegex = /(?:-F|--form)\s+(['"])(.*?)\1/g
    const formFields: KeyValue[] = []
    let formMatch
    while ((formMatch = formDataRegex.exec(normalized)) !== null) {
      const formValue = formMatch[2]
      const equalsIndex = formValue.indexOf('=')
      if (equalsIndex > 0) {
        formFields.push({
          key: formValue.substring(0, equalsIndex).trim(),
          value: formValue.substring(equalsIndex + 1).trim(),
          enabled: true
        })
      }
    }
    
    if (formFields.length > 0) {
      body = {
        type: 'form-data',
        fields: formFields
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
      id: generateId('curl'),
      name,
      type: 'http',
      method,
      url: urlObj.origin + urlObj.pathname,
      headers,
      params,
      body,
      documentation: `Imported from curl command`,
      tags: ['curl-import']
    }

    return request
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    logger.error('[CurlImportService] Error parsing curl command', { message: errorMessage })
    return null
  }
}

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
    const request = parseCurlCommand(command)
    if (request) {
      requests.push(request)
    }
  }

  const folder = new EnvironmentFolder({
    name: options.folderName ?? 'cURL Imports',
    documentation: `Imported from ${requests.length} curl command(s)`,
    tags: ['curl'],
    items: requests,
    environments: []
  })

  return folder
}
