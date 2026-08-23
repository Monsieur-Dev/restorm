/**
 * Add / edit a cookie — the Cookie jar modal. Opened either from the global "+"
 * (empty domain), a per-origin "+" (domain pre-filled), or a row's edit button
 * (every field pre-filled, `initialCookie` set → "edit" mode). It collects the
 * full cookie shape — name, value, path, expiry (or session), and the Secure /
 * HttpOnly / SameSite attributes the inline form couldn't — in the same field
 * order as the table it feeds.
 *
 * It doesn't persist itself: it hands the built `CookieInput` (plus the original
 * cookie, when editing) to `onSubmit`, so the parent can detect a same-place
 * collision and ask for confirmation before overwriting, and can remove the old
 * entry when an edit renames the cookie.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, DateTimePicker, InputBox, Modal, SelectBox, Toggle } from 'electron-core-ui/renderer'
import type { CookieInput, CookieRow } from '../../../../shared/cookies/cookieTypes'
import './CookieAddModal.css'

export interface CookieAddModalProps {
  isOpen: boolean
  onClose: () => void
  /** Pre-filled origin when opened from a per-origin "+"; empty otherwise. */
  initialDomain?: string
  /** When set, the modal edits this cookie (every field pre-filled) instead of
   * adding a new one. */
  initialCookie?: CookieRow
  /** Hands the built cookie (and the original, when editing) to the parent,
   * which owns persistence + the collision confirmation. */
  onSubmit: (input: CookieInput, original: CookieRow | undefined) => void
}

const SAME_SITE_OPTIONS = ['—', 'Lax', 'Strict', 'None'] as const

/** Index of a stored SameSite value in the option list (case-insensitive; 0 = absent). */
function sameSiteIndex(value: string | null): number {
  if (value === null) return 0
  const i = SAME_SITE_OPTIONS.findIndex((o) => o.toLowerCase() === value.toLowerCase())
  return i < 0 ? 0 : i
}

export function CookieAddModal({ isOpen, onClose, initialDomain, initialCookie, onSubmit }: CookieAddModalProps): React.JSX.Element {
  const { t } = useTranslation()
  const editing = initialCookie !== undefined
  // Fresh state per open — the parent remounts this via a `key`, so the initial
  // values (a pre-filled domain, or the edited cookie's fields) are set here
  // rather than in a reset effect.
  const [name, setName] = useState(initialCookie?.key ?? '')
  const [value, setValue] = useState(initialCookie?.value ?? '')
  const [domain, setDomain] = useState(initialCookie?.domain ?? initialDomain ?? '')
  const [path, setPath] = useState(initialCookie?.path ?? '/')
  const [isSession, setIsSession] = useState(initialCookie ? initialCookie.expires === null : true)
  const [expiresDate, setExpiresDate] = useState<Date | null>(initialCookie?.expires ? new Date(initialCookie.expires) : null)
  const [secure, setSecure] = useState(initialCookie?.secure ?? false)
  const [httpOnly, setHttpOnly] = useState(initialCookie?.httpOnly ?? false)
  const [sameSiteIdx, setSameSiteIdx] = useState(sameSiteIndex(initialCookie?.sameSite ?? null))

  const canSubmit = name.trim() !== '' && domain.trim() !== '' && (isSession || expiresDate !== null)

  function submit(): void {
    if (!canSubmit) return
    const sameSite = SAME_SITE_OPTIONS[sameSiteIdx]
    const rawDomain = domain.trim()
    // Preserve a domain-cookie (leading dot) when editing one whose domain the
    // user didn't change — a bare domain would otherwise flip it to host-only.
    const keepDot = initialCookie?.hostOnly === false && rawDomain === initialCookie.domain
    const outDomain = keepDot ? `.${rawDomain}` : rawDomain
    const input: CookieInput = {
      key: name.trim(),
      value,
      domain: outDomain,
      path: path.trim() || '/',
      secure,
      httpOnly,
      ...(isSession || expiresDate === null ? {} : { expires: expiresDate.toISOString() }),
      ...(sameSite !== undefined && sameSite !== '—' ? { sameSite } : {})
    }
    onSubmit(input, initialCookie)
    onClose()
  }

  return (
    <Modal
      title={editing ? t('cookies.editTitle', 'Edit a cookie') : t('cookies.addTitle', 'Add a cookie')}
      isOpen={isOpen}
      onClose={onClose}
      size="dialog"
      dialogWidth={460}
    >
      <div className="cookie-add-modal" data-testid="cookie-add-modal">
        <label className="cookie-add-field">
          <span>{t('cookies.column.domain', 'Domain')}</span>
          <InputBox value={domain} changeDebounceMs={0} onChange={setDomain} options={{ placeholder: 'api.example.com' }} data-testid="cookie-add-modal-domain" />
        </label>
        <label className="cookie-add-field">
          <span>{t('cookies.column.name', 'Name')}</span>
          <InputBox value={name} changeDebounceMs={0} onChange={setName} options={{}} data-testid="cookie-add-modal-name" />
        </label>
        <label className="cookie-add-field">
          <span>{t('cookies.column.value', 'Value')}</span>
          <InputBox value={value} changeDebounceMs={0} onChange={setValue} options={{}} data-testid="cookie-add-modal-value" />
        </label>
        <label className="cookie-add-field">
          <span>{t('cookies.column.path', 'Path')}</span>
          <InputBox value={path} changeDebounceMs={0} onChange={setPath} options={{}} data-testid="cookie-add-modal-path" />
        </label>

        <div className="cookie-add-field">
          <span>{t('cookies.column.expires', 'Expires')}</span>
          <div className="cookie-add-expiry">
            <label className="cookie-add-inline">
              <Toggle checked={isSession} onChange={setIsSession} aria-label={t('cookies.session', 'Session')} />
              <span>{t('cookies.session', 'Session')}</span>
            </label>
            {!isSession && (
              <div className="cookie-add-datetime" data-testid="cookie-add-modal-expires">
                <DateTimePicker
                  value={expiresDate}
                  onChange={(next: Date) => { setExpiresDate(next) }}
                  outputMode="iso"
                  includeTime
                />
              </div>
            )}
          </div>
        </div>

        <div className="cookie-add-field">
          <span>{t('cookies.column.flags', 'Flags')}</span>
          <div className="cookie-add-flags">
            <label className="cookie-add-inline">
              <Toggle checked={secure} onChange={setSecure} aria-label="Secure" />
              <span>Secure</span>
            </label>
            <label className="cookie-add-inline">
              <Toggle checked={httpOnly} onChange={setHttpOnly} aria-label="HttpOnly" />
              <span>HttpOnly</span>
            </label>
            <label className="cookie-add-inline cookie-add-samesite">
              <span>SameSite</span>
              <SelectBox
                id="cookie-add-modal-samesite"
                className="cookie-add-samesite-select"
                options={SAME_SITE_OPTIONS.map((o) => ({ text: o }))}
                selected={sameSiteIdx}
                onDidSelect={({ index }) => { setSameSiteIdx(index) }}
                selectBoxOptions={{ ariaLabel: 'SameSite' }}
                data-testid="cookie-add-modal-samesite"
              />
            </label>
          </div>
        </div>

        <div className="cookie-add-footer">
          <Button secondary onClick={onClose} data-testid="cookie-add-modal-cancel">{t('cookies.cancel', 'Cancel')}</Button>
          <Button disabled={!canSubmit} onClick={submit} data-testid="cookie-add-modal-submit">
            {editing ? t('cookies.save', 'Save') : t('cookies.add', 'Add')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
