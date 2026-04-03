import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { z } from 'zod/v4'
import { logger } from '../services/LoggerService'

/**
 * Register an IPC handler with zod schema validation on the arguments.
 *
 * When the renderer sends arguments that don't match the schema, the handler
 * rejects with a descriptive error message instead of passing garbage data to
 * the service layer.
 *
 * @example
 * ```ts
 * validatedHandle('theme:load', z.tuple([z.string()]), (_event, [themeId]) => {
 *   return themeService.getThemeWithVariables(themeId)
 * })
 * ```
 */
export function validatedHandle<S extends z.ZodType, R>(
  channel: string,
  schema: S,
  handler: (event: IpcMainInvokeEvent, args: z.infer<S>) => R | Promise<R>
): void {
  ipcMain.handle(channel, (event, ...rawArgs: unknown[]) => {
    const result = schema.safeParse(rawArgs)
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
      logger.warn(`[IPC] Validation failed on "${channel}"`, { issues })
      return Promise.reject(new Error(`IPC validation error on "${channel}": ${issues}`))
    }
    return handler(event, result.data as z.infer<S>)
  })
}
