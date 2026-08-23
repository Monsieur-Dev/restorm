/**
 * MCP cookie tools — read + mutate the per-environment cookie jar
 * (`CookieJarService`). Gated Pro + Enterprise (see `mcpProGate.ts`), matching
 * the rest of the advanced automation surface.
 *
 * The jar is keyed by environment id; pass `environmentId` (from
 * `list_environments`) or omit it for the default "no environment" jar. Every
 * mutation returns the fresh cookie list so the agent can audit the result
 * without a second round-trip, and the open Cookie jar refreshes live.
 */
import { z } from 'zod'
import { McpService } from 'electron-core-ui'
import { cookieJarService } from '../../services/CookieJarService'
import type { CookieInput } from '../../../shared/cookies/cookieTypes'

function jsonReply(value: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

function errorReply(message: string): { content: { type: 'text'; text: string }[]; isError: true } {
  return { content: [{ type: 'text', text: message }], isError: true }
}

/** Resolve the `environmentId` arg to a jar key ('' = the default jar). */
function envKeyOf(args: Record<string, unknown>): string {
  const raw = args['environmentId']
  return typeof raw === 'string' ? raw : ''
}

function str(args: Record<string, unknown>, key: string): string {
  const v = args[key]
  return typeof v === 'string' ? v : ''
}

export function registerCookieTools(mcp: McpService): void {
  mcp.registerTool(
    'list_cookies',
    {
      titleKey: 'mcpToolTitles.listCookies',
      title: 'List cookies',
      description:
        'List every cookie stored in an environment\'s jar. Pass `environmentId` (from ' +
        '`list_environments`) or omit it for the default "no environment" jar. Returns an ' +
        'array of `{ key, value, domain, path, expires, secure, httpOnly, sameSite, hostOnly }` ' +
        '(expires is an ISO string, or null for a session cookie).',
      inputSchema: {
        environmentId: z.string().optional().describe('Environment id whose jar to read; omit for the default jar.')
      } as Record<string, unknown>
    },
    (args) => jsonReply(cookieJarService.list(envKeyOf(args)))
  )

  mcp.registerTool(
    'add_cookie',
    {
      titleKey: 'mcpToolTitles.addCookie',
      title: 'Add a cookie',
      description:
        'Add (or overwrite) a cookie in an environment\'s jar. A cookie is identified by ' +
        '(name + domain + path), so adding one with the same triple replaces it. `value` may ' +
        'embed `{{var}}`, resolved against the active environment at send time. Omit `expires` ' +
        'for a session cookie. Returns the refreshed cookie list.',
      inputSchema: {
        environmentId: z.string().optional().describe('Environment id whose jar to write; omit for the default jar.'),
        key: z.string().min(1).describe('Cookie name.'),
        value: z.string().describe('Cookie value (may contain {{var}}).'),
        domain: z.string().min(1).describe('Cookie domain, e.g. "api.example.com". A leading dot makes it a domain cookie.'),
        path: z.string().optional().describe('Cookie path (defaults to "/").'),
        expires: z.string().optional().describe('Expiry as an ISO 8601 string; omit for a session cookie.'),
        secure: z.boolean().optional().describe('Secure attribute.'),
        httpOnly: z.boolean().optional().describe('HttpOnly attribute.'),
        sameSite: z.enum(['Lax', 'Strict', 'None']).optional().describe('SameSite attribute.')
      } as Record<string, unknown>
    },
    (args) => {
      const key = str(args, 'key')
      const domain = str(args, 'domain')
      if (!key) return errorReply('key is required')
      if (!domain) return errorReply('domain is required')
      const input: CookieInput = {
        key,
        value: str(args, 'value'),
        domain,
        ...(typeof args['path'] === 'string' ? { path: args['path'] } : {}),
        ...(typeof args['expires'] === 'string' ? { expires: args['expires'] } : {}),
        ...(typeof args['secure'] === 'boolean' ? { secure: args['secure'] } : {}),
        ...(typeof args['httpOnly'] === 'boolean' ? { httpOnly: args['httpOnly'] } : {}),
        ...(typeof args['sameSite'] === 'string' ? { sameSite: args['sameSite'] } : {})
      }
      const envKey = envKeyOf(args)
      cookieJarService.addCookie(envKey, input)
      return jsonReply(cookieJarService.list(envKey))
    }
  )

  mcp.registerTool(
    'remove_cookie',
    {
      titleKey: 'mcpToolTitles.removeCookie',
      title: 'Remove a cookie',
      description:
        'Remove a single cookie from an environment\'s jar by its (name + domain + path). ' +
        'Returns the refreshed cookie list.',
      inputSchema: {
        environmentId: z.string().optional().describe('Environment id whose jar to write; omit for the default jar.'),
        domain: z.string().min(1).describe('Cookie domain (as returned by list_cookies).'),
        path: z.string().min(1).describe('Cookie path (as returned by list_cookies).'),
        key: z.string().min(1).describe('Cookie name.')
      } as Record<string, unknown>
    },
    (args) => {
      const domain = str(args, 'domain')
      const path = str(args, 'path')
      const key = str(args, 'key')
      if (!domain || !path || !key) return errorReply('domain, path and key are all required')
      const envKey = envKeyOf(args)
      cookieJarService.removeCookie(envKey, domain, path, key)
      return jsonReply(cookieJarService.list(envKey))
    }
  )

  mcp.registerTool(
    'clear_cookie_domain',
    {
      titleKey: 'mcpToolTitles.clearCookieDomain',
      title: 'Clear cookies for a domain',
      description:
        'Remove every cookie for a domain from an environment\'s jar. Returns the refreshed list.',
      inputSchema: {
        environmentId: z.string().optional().describe('Environment id whose jar to write; omit for the default jar.'),
        domain: z.string().min(1).describe('Domain whose cookies to clear.')
      } as Record<string, unknown>
    },
    (args) => {
      const domain = str(args, 'domain')
      if (!domain) return errorReply('domain is required')
      const envKey = envKeyOf(args)
      cookieJarService.clearDomain(envKey, domain)
      return jsonReply(cookieJarService.list(envKey))
    }
  )

  mcp.registerTool(
    'clear_cookies',
    {
      titleKey: 'mcpToolTitles.clearCookies',
      title: 'Clear all cookies in an environment',
      description:
        'Remove every cookie from an environment\'s jar. Pass `environmentId` or omit it for ' +
        'the default jar. Returns the (now empty) cookie list.',
      inputSchema: {
        environmentId: z.string().optional().describe('Environment id whose jar to clear; omit for the default jar.')
      } as Record<string, unknown>
    },
    (args) => {
      const envKey = envKeyOf(args)
      cookieJarService.clear(envKey)
      return jsonReply(cookieJarService.list(envKey))
    }
  )
}
