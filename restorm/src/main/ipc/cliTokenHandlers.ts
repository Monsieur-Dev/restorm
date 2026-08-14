/**
 * IPC handlers for "manage my CLI/CI tokens", exposed to the renderer under
 * `window.api.cliTokens.*`.
 *
 * The renderer never receives a session credential — it sends an intent and
 * gets data back. Every reply is a result object rather than a thrown error,
 * so the modal can tell a signed-out user, a member without the right, and a
 * backend outage apart, and say something different for each.
 */
import { z } from 'zod'
import { validatedHandle } from 'electron-core-ui'
import { CLI_TOKEN_IPC } from '../../shared/cliTokens/cliTokenTypes'
import { createCliToken, listCliTokens, revokeCliToken } from '../services/cliTokens/cliTokenService'
import { noArgs } from './schemas'

/** A lifetime is a whole number of days, or null for "never expires". The
 * backend re-validates this — the schema here is to reject nonsense before it
 * costs a round trip, not to be the authority. */
const createArgs = z.tuple([z.string(), z.number().int().positive().nullable()])
const revokeArgs = z.tuple([z.string()])

export function registerCliTokenIpc(): void {
  // `validatedHandle` hands the handler `(event, parsedArgsTuple)` — the args
  // arrive as ONE array, not as separate parameters. Destructuring the tuple is
  // the house idiom (see updateHandlers); taking them as positional parameters
  // silently binds the IpcMainInvokeEvent to the first one, which is how a
  // token name reached the backend as an event object and came back rejected.
  validatedHandle(CLI_TOKEN_IPC.LIST, noArgs, async () => await listCliTokens())
  validatedHandle(
    CLI_TOKEN_IPC.CREATE,
    createArgs,
    async (_event, [name, expiresInDays]) => await createCliToken(name, expiresInDays)
  )
  validatedHandle(
    CLI_TOKEN_IPC.REVOKE,
    revokeArgs,
    async (_event, [id]) => await revokeCliToken(id)
  )
}
