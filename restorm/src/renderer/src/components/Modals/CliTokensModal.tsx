/**
 * "My CLI/CI tokens" — see, create and revoke the tokens that let a headless
 * run (CI, or `--headless` locally) authenticate as this organization.
 *
 * Only the signed-in user's own tokens appear here, and that is decided by the
 * BACKEND, not by this component: the API returns what the caller is entitled
 * to see. Nothing here filters, and nothing here should — a second opinion
 * about who may see what is how the two end up disagreeing.
 *
 * The plaintext is shown exactly once, right after creation, and can never be
 * retrieved again (only its hash is stored, on our side too). That moment is
 * the delicate part of this screen: it gets a dedicated panel, a copy button
 * and an explicit warning, because there is no second chance.
 */

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, InputBox, Modal, SelectBox, useAuthState } from 'electron-core-ui/renderer'
import {
  CLI_TOKEN_LIFETIMES,
  MAX_CLI_TOKEN_NAME_LENGTH,
  type CliTokenFailure,
  type CliTokenSummary,
  type CreatedCliToken
} from '../../../../shared/cliTokens/cliTokenTypes'
import './CliTokensModal.css'

/** A token's live state. Expiry is compared against the local clock for DISPLAY
 * only — the licence endpoint re-checks it when the token is actually used, so
 * a skewed clock can mislabel a row but can neither grant nor deny anything. */
function stateOf(t: CliTokenSummary): 'revoked' | 'expired' | 'active' {
  if (t.revokedAt) return 'revoked'
  if (t.expiresAt && Date.parse(t.expiresAt) <= Date.now()) return 'expired'
  return 'active'
}

function formatDate(iso: string | null, locale: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
}

export interface CliTokensModalProps {
  isOpen: boolean
  onClose: () => void
}

/**
 * Why creating a token is impossible right now, or null when it is possible.
 *
 * The modal always opens, whatever the answer: someone whose subscription
 * lapsed still has to be able to retire the tokens they made while subscribed,
 * and someone who has never subscribed should learn that headless runs are one
 * of the things a plan buys. So a refusal disables the CREATION controls and
 * explains itself — it never hides the screen, and it never disables revoke.
 *
 * The order is the order of precedence: the most fundamental cause wins, so a
 * signed-out user is not told to contact their administrator.
 */
function blockReasonFor(
  signedIn: boolean,
  plan: string,
  failure: CliTokenFailure | null
): 'signed-out' | 'plan-required' | 'unavailable' | 'forbidden' | null {
  if (!signedIn) return 'signed-out'
  if (failure === 'signed-out' || failure === 'plan-required') return failure
  if (plan === 'community') return 'plan-required'
  if (failure === 'unavailable') return 'unavailable'
  if (failure === 'forbidden') return 'forbidden'
  return null
}

/** Positional, because SelectBox addresses its options by INDEX. */
const LIFETIME_OPTIONS = CLI_TOKEN_LIFETIMES

export function CliTokensModal({ isOpen, onClose }: CliTokensModalProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { signedIn, plan } = useAuthState()
  const [tokens, setTokens] = useState<CliTokenSummary[]>([])
  const [failure, setFailure] = useState<CliTokenFailure | null>(null)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [lifetimeDays, setLifetimeDays] = useState<number | null>(30)
  const [justCreated, setJustCreated] = useState<CreatedCliToken | null>(null)
  const [copied, setCopied] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const blockReason = blockReasonFor(signedIn, plan, failure)

  // Starts with the await on purpose: called from an effect, a synchronous
  // setState here would schedule a render before the effect settles.
  const refresh = useCallback(async () => {
    const res = await window.api.cliTokens.list()
    setLoaded(true)
    if (res.ok) {
      setTokens(res.data ?? [])
      setFailure(null)
      return
    }
    setFailure(res.failure ?? 'unavailable')
  }, [])

  useEffect(() => {
    if (!isOpen) return
    // `cancelled` rather than a bare call: the modal can be closed while the
    // list is still in flight, and writing state into an unmounted view is
    // both a warning and a way to resurrect a stale list on the next open.
    // Same shape as AboutModal's version fetch.
    let cancelled = false
    void window.api.cliTokens.list().then((res) => {
      if (cancelled) return
      setLoaded(true)
      if (res.ok) {
        setTokens(res.data ?? [])
        setFailure(null)
        return
      }
      setFailure(res.failure ?? 'unavailable')
    })
    return () => {
      cancelled = true
    }
  }, [isOpen])

  /** Clearing the revealed token happens on CLOSE rather than on open: it wipes
   * the secret at the moment the user walks away from it, instead of leaving it
   * mounted until someone comes back. Same guarantee — a reopened modal never
   * shows a previous visit's token — reached earlier. */
  const handleClose = useCallback(() => {
    setJustCreated(null)
    setCopied(false)
    setFailure(null)
    setLoaded(false)
    onClose()
  }, [onClose])

  async function create(): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    const res = await window.api.cliTokens.create(trimmed, lifetimeDays)
    setBusy(false)
    if (res.ok && res.data) {
      setJustCreated(res.data)
      setCopied(false)
      setName('')
      setFailure(null)
      await refresh()
      return
    }
    setFailure(res.failure ?? 'unavailable')
  }

  async function revoke(id: string): Promise<void> {
    setBusy(true)
    const res = await window.api.cliTokens.revoke(id)
    setBusy(false)
    if (res.ok) {
      setFailure(null)
      await refresh()
      return
    }
    setFailure(res.failure ?? 'unavailable')
  }

  async function copyToken(): Promise<void> {
    if (!justCreated) return
    await navigator.clipboard.writeText(justCreated.token)
    setCopied(true)
  }

  return (
    <Modal
      title={t('cliTokens.title')}
      isOpen={isOpen}
      onClose={handleClose}
      size="dialog"
      dialogWidth={720}
    >
      <div className="cli-tokens">
        <p className="cli-tokens-intro">{t('cliTokens.intro')}</p>

        {blockReason !== null && (
          <div className="cli-tokens-callout" role="status" data-testid="cli-tokens-callout">
            {t(`cliTokens.failure.${blockReason}`)}
          </div>
        )}

        {/* A failure that isn't a standing refusal — a name the backend
            rejected, a token that vanished — is transient and belongs next to
            the action, not in the callout that explains the screen's state. */}
        {failure !== null && blockReasonFor(signedIn, plan, failure) === null && (
          <div className="cli-tokens-error" role="alert" data-testid="cli-tokens-error">
            {t(`cliTokens.failure.${failure}`)}
          </div>
        )}

        {justCreated && (
          <div className="cli-tokens-reveal" data-testid="cli-tokens-reveal">
            <p className="cli-tokens-reveal-warning">{t('cliTokens.revealWarning')}</p>
            <code className="cli-tokens-reveal-value">{justCreated.token}</code>
            <Button icon={copied ? 'check' : 'copy'} onClick={() => void copyToken()}>
              {copied ? t('cliTokens.copied') : t('cliTokens.copy')}
            </Button>
          </div>
        )}

        {!loaded
          ? null
          : tokens.length === 0
          ? <p className="cli-tokens-empty">{t('cliTokens.empty')}</p>
          : (
            <table className="cli-tokens-table" data-testid="cli-tokens-table">
              <thead>
                <tr>
                  <th>{t('cliTokens.column.name')}</th>
                  <th>{t('cliTokens.column.created')}</th>
                  <th>{t('cliTokens.column.expires')}</th>
                  <th>{t('cliTokens.column.lastUsed')}</th>
                  <th>{t('cliTokens.column.status')}</th>
                  <th aria-label={t('cliTokens.column.actions')} />
                </tr>
              </thead>
              <tbody>
                {tokens.map((token) => (
                  <tr key={token.id}>
                    <td>{token.name}</td>
                    <td className="cli-tokens-muted">{formatDate(token.createdAt, i18n.language)}</td>
                    <td className="cli-tokens-muted">
                      {token.expiresAt
                        ? formatDate(token.expiresAt, i18n.language)
                        : t('cliTokens.never')}
                    </td>
                    <td className="cli-tokens-muted">
                      {token.lastUsedAt
                        ? formatDate(token.lastUsedAt, i18n.language)
                        : t('cliTokens.never')}
                    </td>
                    <td>
                      <span className={`cli-tokens-badge cli-tokens-badge--${stateOf(token)}`}>
                        {t(`cliTokens.state.${stateOf(token)}`)}
                      </span>
                    </td>
                    <td>
                      <Button
                        icon="trash"
                        disabled={busy || stateOf(token) !== 'active'}
                        onClick={() => void revoke(token.id)}
                        options={{ ariaLabel: t('cliTokens.revokeNamed', { name: token.name }) }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

        {/* Shown always, disabled when creation is refused. The callout above
            says why — a control that is present but inert next to its reason
            teaches what would unlock it, where a hidden form teaches nothing. */}
        <div className="cli-tokens-create">
          <InputBox
            className="cli-tokens-name"
            value={name}
            /* No debounce: the value is only read when the button is pressed,
               and a 300 ms delay would let a fast typist hit Create before
               their last keystrokes had reached this component. */
            changeDebounceMs={0}
            disabled={blockReason !== null}
            options={{
              placeholder: t('cliTokens.namePlaceholder'),
              ariaLabel: t('cliTokens.nameLabel'),
              // Same ceiling the backend enforces. The server stays the
              // authority — this only spares a round trip that can only end in
              // a refusal.
              maxLength: MAX_CLI_TOKEN_NAME_LENGTH
            }}
            onChange={(next) => { setName(next) }}
            data-testid="cli-tokens-name"
          />
          <SelectBox
            id="cli-tokens-lifetime"
            className="cli-tokens-lifetime"
            options={LIFETIME_OPTIONS.map(({ days }) => ({
              text: days === null
                ? t('cliTokens.noExpiration')
                : t('cliTokens.days', { count: days })
            }))}
            selected={LIFETIME_OPTIONS.findIndex((o) => o.days === lifetimeDays)}
            disabled={blockReason !== null}
            selectBoxOptions={{ ariaLabel: t('cliTokens.lifetimeLabel') }}
            onDidSelect={({ index }) => { setLifetimeDays(LIFETIME_OPTIONS[index]?.days ?? null) }}
            data-testid="cli-tokens-lifetime"
          />
          <Button
            disabled={busy || blockReason !== null || !name.trim()}
            onClick={() => void create()}
            data-testid="cli-tokens-create"
          >
            {t('cliTokens.create')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
