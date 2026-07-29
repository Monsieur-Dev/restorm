/**
 * IPC handlers for crash reporting. Exposed to the renderer under
 * `window.api.crash.*` (see preload). All args are zod-validated.
 *
 * The surface is deliberately read-only: the renderer can ask whether reporting
 * is armed and be told when that changes, and nothing else. There is no channel
 * by which a renderer could arm it — the decision belongs to the main process,
 * and an IPC channel that could flip it would be a way around the consent gate.
 */
import { validatedHandle } from 'electron-core-ui'
import { CRASH_IPC, type CrashArmedState } from '../../shared/crash/crashTypes'
import { getCrashReportingService } from '../services/crash/sentryComposition'
import { noArgs } from './schemas'

/**
 * The state reported when crash reporting was never built — no DSN, or the
 * service threw at boot. Fails closed: the renderer initialises nothing.
 */
const UNPROVISIONED: CrashArmedState = { armed: false, reason: 'no-dsn' }

export function registerCrashIpc(): void {
  validatedHandle(
    CRASH_IPC.GET_ARMED_STATE,
    noArgs,
    (): CrashArmedState => getCrashReportingService()?.getArmedState() ?? UNPROVISIONED
  )
}
