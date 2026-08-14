/**
 * The CLI/CI token surface, as the renderer sees it.
 *
 * A token authenticates a headless run (CI, or `--headless` locally) against
 * the user's organization. It is redeemed by ONE endpoint — the licence check —
 * and grants no data access and no administrative rights, which is why an
 * ordinary member may hold one.
 *
 * The plaintext exists exactly once, in the reply to a creation call. It is
 * never stored anywhere, here or on the backend (only its SHA-256), so it can
 * never be retrieved again: whatever surface shows it has one chance.
 */

/** IPC channels for the token operations. Kept beside the types so a channel
 * name and its payload cannot drift apart. */
export const CLI_TOKEN_IPC = {
  LIST: 'cli-tokens:list',
  CREATE: 'cli-tokens:create',
  REVOKE: 'cli-tokens:revoke'
} as const

/** One of the caller's tokens. Never carries the token itself. */
export interface CliTokenSummary {
  id: string
  name: string
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
  /** When it stops being accepted; null = never expires. */
  expiresAt: string | null
}

/** The one and only time the plaintext is available. */
export interface CreatedCliToken {
  id: string
  /** Shown once, never retrievable again. */
  token: string
  expiresAt: string | null
}

/**
 * Why a token operation could not be performed, in terms the UI can act on
 * rather than an HTTP status.
 *
 * `signed-out` and `forbidden` are deliberately distinct: the first asks the
 * user to log in, the second has to explain that their organization has not
 * granted them the right — a member who sees a dead button and no reason
 * assumes the app is broken.
 */
export type CliTokenFailure =
  | 'signed-out'
  /** The org's plan does not include headless execution, which is the whole
   * point of a token. Distinct from `forbidden`: one is fixed by upgrading,
   * the other by asking an administrator. */
  | 'plan-required'
  | 'forbidden'
  | 'invalid-name'
  | 'invalid-expiry'
  | 'not-found'
  | 'unavailable'

export interface CliTokenResult<T> {
  ok: boolean
  data?: T
  failure?: CliTokenFailure
}

/** The lifetimes offered at creation. `null` = never expires, which is what
 * every token created before expiry existed does — a real, named choice rather
 * than a hidden default. Mirrors the dashboard's set deliberately: the same
 * decision should not read differently in two places. */
export const CLI_TOKEN_LIFETIMES: readonly { days: number | null }[] = [
  { days: 7 },
  { days: 30 },
  { days: 60 },
  { days: 90 },
  { days: 365 },
  { days: null }
]

/** Longest accepted token label. Mirrors `MAX_CLI_TOKEN_NAME_LENGTH` in the
 * backend's `admin` function — the server remains the authority, and this
 * constant only lets the UI stop a label that could only be refused. */
export const MAX_CLI_TOKEN_NAME_LENGTH = 200
