/**
 * IPC handlers for crash reporting. Exposed to the renderer under
 * `window.api.crash.*` (see preload). All args are zod-validated.
 *
 * The surface is almost entirely read-only: the renderer can ask whether
 * reporting is armed, whether the user still owes an answer, and be told when
 * either changes. It cannot arm reporting — that decision belongs to the main
 * process, and a channel that could flip it would be a way around the consent
 * gate.
 *
 * The one write records the user's OWN answer, and it cannot defeat the plan
 * either: the consent layer applies the plan override AFTER the stored value, so
 * a Community client asking to opt out still resolves to granted. The write
 * expresses a choice; it does not grant a right the plan withholds.
 */
import { z } from 'zod/v4'
import { validatedHandle } from 'electron-core-ui'
import {
  CRASH_IPC,
  type CrashArmedState,
  type CrashConsentState
} from '../../shared/crash/crashTypes'
import { getCrashReportingService } from '../services/crash/sentryComposition'
import { getConsentService } from '../services/privacy/consentComposition'
import { readCrashConsentState } from '../services/crash/crashConsentState'
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

  validatedHandle(
    CRASH_IPC.GET_CONSENT_STATE,
    noArgs,
    (): CrashConsentState => readCrashConsentState()
  )

  validatedHandle(
    CRASH_IPC.SET_CONSENT,
    z.tuple([z.boolean()]),
    (_event, [granted]): CrashConsentState => {
      // `setGranted` rather than a settings write, and the difference is the
      // whole feature. The prompt's checkbox is pre-checked and the stored
      // default is already `true`, so the commonest answer — "yes, leave it on"
      // — changes no value at all. A settings write would emit no change event,
      // the audit trail would never be stamped, the gate would stay "nobody has
      // decided", and the prompt would come back on every launch however many
      // times the user answered it. `setGranted` records regardless.
      getConsentService()?.setGranted('crash', granted)
      return readCrashConsentState()
    }
  )
}
