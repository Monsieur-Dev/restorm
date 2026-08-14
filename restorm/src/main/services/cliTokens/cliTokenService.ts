/**
 * The main-process half of "manage my CLI/CI tokens from inside the app".
 *
 * Everything here goes through `EntitlementService.postWithSession`, which is
 * the only holder of the session JWT. The token never crosses into the
 * renderer: the renderer sends an intent, the main process authenticates it,
 * and only data comes back.
 *
 * Scope is NOT enforced here. The backend decides what a caller may see and
 * touch — a member receives only the tokens they minted and may revoke only
 * those. Re-implementing that rule in this file would create a second opinion
 * about the same question, and the wrong one would be the one nobody notices.
 */

import { app } from 'electron'
import { getFeatureService, isFeatureServiceInitialized, SessionCallError } from 'electron-core-ui/main'
import { isDocsCaptureSeamEnabled } from '../../featureFlags'
import { getEntitlementService } from '../auth/authComposition'
import { endpointUrl, resolveChannel } from '../../../shared/config/backend'
import type {
  CliTokenFailure,
  CliTokenResult,
  CliTokenSummary,
  CreatedCliToken
} from '../../../shared/cliTokens/cliTokenTypes'

/**
 * Fixed sample tokens for the documentation-capture harness.
 *
 * Dates are constants, not `now`-relative: a screenshot taken twice must be
 * byte-identical, and a relative date changes the pixels every day. One active
 * token that never expires, one already expired — the two states the docs need
 * to show — and no revoked row, because a revoked token is a state the reader
 * reaches by acting, not one to illustrate.
 */
const DOC_CAPTURE_TOKENS: CliTokenSummary[] = [
  {
    id: 'doc-1',
    name: 'ci-main',
    createdAt: '2026-07-15T09:00:00.000Z',
    lastUsedAt: '2026-08-01T09:00:00.000Z',
    revokedAt: null,
    expiresAt: null
  },
  {
    id: 'doc-2',
    name: 'nightly-build',
    createdAt: '2026-06-01T09:00:00.000Z',
    lastUsedAt: null,
    revokedAt: null,
    expiresAt: '2026-07-01T09:00:00.000Z'
  }
]

/** Whether to answer from {@link DOC_CAPTURE_TOKENS} instead of the backend.
 * False whenever the feature service has not booted — failing closed matters
 * more here than covering an early-boot call that cannot happen in practice. */
function capturingDocs(): boolean {
  return isFeatureServiceInitialized() && isDocsCaptureSeamEnabled(getFeatureService())
}

function adminUrl(): string {
  return endpointUrl(resolveChannel(app.getVersion()), 'admin')
}

/**
 * Map a failed backend call onto something the UI can say. An unmapped status
 * becomes `unavailable` rather than being guessed at — telling a user "you are
 * not allowed" when the backend was merely down would be a lie that costs them
 * a support message.
 */
function failureFor(err: unknown): CliTokenFailure {
  if (err instanceof SessionCallError) {
    if (err.status === 401) return 'signed-out'
    // Both are 403; only the code tells them apart, and they lead the user to
    // two different places — the pricing page, or their administrator.
    if (err.status === 403) return err.code === 'plan_required' ? 'plan-required' : 'forbidden'
    if (err.status === 404) return 'not-found'
    if (err.code === 'invalid_name') return 'invalid-name'
    if (err.code === 'invalid_expiry') return 'invalid-expiry'
  }
  return 'unavailable'
}

async function call<T>(body: Record<string, unknown>): Promise<CliTokenResult<T>> {
  try {
    const data = await getEntitlementService().postWithSession<T>(adminUrl(), body)
    // `null` means there is no usable session at all — not an error to report
    // as a failure of the operation, but a prompt to sign in.
    if (data === null) return { ok: false, failure: 'signed-out' }
    return { ok: true, data }
  } catch (err) {
    return { ok: false, failure: failureFor(err) }
  }
}

/** The caller's own tokens, newest first (the backend orders them). */
export async function listCliTokens(): Promise<CliTokenResult<CliTokenSummary[]>> {
  if (capturingDocs()) return { ok: true, data: DOC_CAPTURE_TOKENS }
  const res = await call<{ tokens: CliTokenSummary[] }>({ action: 'listCliTokens' })
  return res.ok ? { ok: true, data: res.data?.tokens ?? [] } : res as CliTokenResult<CliTokenSummary[]>
}

/**
 * Mint a token. `expiresInDays` null means it never expires — sent by omitting
 * the field, matching what the backend treats as "no expiry", rather than
 * inventing a sentinel the API would have to learn.
 */
export async function createCliToken(
  name: string,
  expiresInDays: number | null
): Promise<CliTokenResult<CreatedCliToken>> {
  return await call<CreatedCliToken>({
    action: 'createCliToken',
    name,
    ...(expiresInDays === null ? {} : { expiresInDays })
  })
}

/** Revoke one of the caller's own tokens. Effective immediately. */
export async function revokeCliToken(id: string): Promise<CliTokenResult<{ ok: true }>> {
  return await call<{ ok: true }>({ action: 'revokeCliToken', id })
}
