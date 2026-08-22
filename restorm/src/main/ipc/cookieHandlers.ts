/**
 * IPC handlers for the Cookie Manager, exposed under `window.api.cookies.*`.
 *
 * The jar lives in the main process (`cookieJarService`), keyed by
 * environment. The renderer passes an environment key (the active
 * environment's id, or '' for the default jar) and gets back the current
 * cookie rows; every mutation returns the fresh list so the modal can
 * re-render without a second round trip.
 */
import { BrowserWindow } from 'electron'
import { z } from 'zod'
import { validatedHandle } from 'electron-core-ui'
import { COOKIE_IPC } from '../../shared/cookies/cookieTypes'
import { cookieJarService } from '../services/CookieJarService'

const envKeyArgs = z.tuple([z.string()])
const cookieInput = z.object({
  key: z.string(),
  value: z.string(),
  domain: z.string(),
  path: z.string().optional(),
  expires: z.string().optional(),
  secure: z.boolean().optional(),
  httpOnly: z.boolean().optional(),
  sameSite: z.string().optional()
})
const addArgs = z.tuple([z.string(), cookieInput])
const removeArgs = z.tuple([z.string(), z.string(), z.string(), z.string()])
const clearDomainArgs = z.tuple([z.string(), z.string()])
const clearArgs = z.tuple([z.string().optional()])

export function registerCookieIpc(): void {
  // Push a live-refresh to every window whenever a jar mutates — a request
  // captured a Set-Cookie, or the UI added / removed / cleared cookies.
  cookieJarService.setChangeNotifier(() => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(COOKIE_IPC.CHANGED)
    }
  })
  validatedHandle(COOKIE_IPC.LIST, envKeyArgs, (_event, [envKey]) => cookieJarService.list(envKey))
  validatedHandle(COOKIE_IPC.ADD, addArgs, (_event, [envKey, input]) => {
    cookieJarService.addCookie(envKey, input)
    return cookieJarService.list(envKey)
  })
  validatedHandle(COOKIE_IPC.REMOVE, removeArgs, (_event, [envKey, domain, path, key]) => {
    cookieJarService.removeCookie(envKey, domain, path, key)
    return cookieJarService.list(envKey)
  })
  validatedHandle(COOKIE_IPC.CLEAR_DOMAIN, clearDomainArgs, (_event, [envKey, domain]) => {
    cookieJarService.clearDomain(envKey, domain)
    return cookieJarService.list(envKey)
  })
  validatedHandle(COOKIE_IPC.CLEAR, clearArgs, (_event, [envKey]) => {
    cookieJarService.clear(envKey)
    return envKey !== undefined ? cookieJarService.list(envKey) : []
  })
}
