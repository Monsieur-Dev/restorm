/**
 * Cookie Manager — see, edit, add and clear the session cookies restorm
 * captured while sending requests. The jar lives in the main process,
 * keyed by ENVIRONMENT: the selector at the top picks which environment's
 * cookies you're looking at (switching the active environment switches the
 * cookie context), and the rows are grouped by origin.
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, InputBox, Modal, SelectBox } from 'electron-core-ui/renderer'
import { useAllEnvironments } from '../../hooks/useAllEnvironments'
import type { CookieRow } from '../../../../shared/cookies/cookieTypes'
import './CookieManagerModal.css'

export interface CookieManagerModalProps {
  isOpen: boolean
  onClose: () => void
  /** Origin to pre-filter on (from a response panel "cookies" chip). */
  focusDomain?: string
}

/** Stable identity of a cookie within a jar (domain + path + name). */
function rowId(c: CookieRow): string {
  return `${c.domain}\t${c.path}\t${c.key}`
}

function formatExpires(iso: string | null, locale: string): string {
  if (iso === null) return ''
  return new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
}

export function CookieManagerModal({ isOpen, onClose, focusDomain }: CookieManagerModalProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const environments = useAllEnvironments()

  // Selector options: "No environment" (the default jar, key '') then every env.
  const options = useMemo(
    () => [{ id: '', name: t('cookies.noEnvironment', 'No environment') }, ...environments.map((r) => ({ id: r.env.id, name: r.env.name }))],
    [environments, t]
  )
  const [envKey, setEnvKey] = useState('')
  const [rows, setRows] = useState<CookieRow[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  // Add-cookie form.
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [newDomain, setNewDomain] = useState('')
  const [newPath, setNewPath] = useState('/')

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    void window.api.cookies.list(envKey).then((next) => {
      if (!cancelled) { setRows(next); setDrafts({}) }
    })
    return () => { cancelled = true }
  }, [isOpen, envKey])

  // Group rows by domain, in a stable order; honour a focus domain first.
  const groups = useMemo(() => {
    const byDomain = new Map<string, CookieRow[]>()
    for (const c of rows) {
      const list = byDomain.get(c.domain) ?? []
      list.push(c)
      byDomain.set(c.domain, list)
    }
    const domains = [...byDomain.keys()].sort((a, b) => (a === focusDomain ? -1 : b === focusDomain ? 1 : a.localeCompare(b)))
    return domains.map((domain) => ({ domain, cookies: byDomain.get(domain) ?? [] }))
  }, [rows, focusDomain])

  async function saveValue(c: CookieRow): Promise<void> {
    const value = drafts[rowId(c)]
    if (value === undefined || value === c.value) return
    const next = await window.api.cookies.add(envKey, {
      key: c.key, value, domain: c.hostOnly ? c.domain : `.${c.domain}`, path: c.path,
      ...(c.expires !== null ? { expires: c.expires } : {}),
      secure: c.secure, httpOnly: c.httpOnly, ...(c.sameSite !== null ? { sameSite: c.sameSite } : {})
    })
    setRows(next); setDrafts({})
  }

  async function remove(c: CookieRow): Promise<void> {
    setRows(await window.api.cookies.remove(envKey, c.domain, c.path, c.key))
  }
  async function clearDomain(domain: string): Promise<void> {
    setRows(await window.api.cookies.clearDomain(envKey, domain))
  }
  async function clearAll(): Promise<void> {
    setRows(await window.api.cookies.clear(envKey))
  }
  async function addCookie(): Promise<void> {
    if (!newKey.trim() || !newDomain.trim()) return
    const next = await window.api.cookies.add(envKey, {
      key: newKey.trim(), value: newValue, domain: newDomain.trim(), path: newPath.trim() || '/'
    })
    setRows(next); setNewKey(''); setNewValue(''); setNewDomain(''); setNewPath('/')
  }

  return (
    <Modal title={t('cookies.title', 'Cookies')} isOpen={isOpen} onClose={onClose} size="dialog" dialogWidth={860}>
      <div className="cookie-manager" data-testid="cookie-manager">
        <div className="cookie-manager-head">
          <label className="cookie-manager-env-label" htmlFor="cookie-manager-env">
            {t('cookies.environment', 'Environment')}
          </label>
          <SelectBox
            id="cookie-manager-env"
            className="cookie-manager-env"
            options={options.map((o) => ({ text: o.name }))}
            selected={Math.max(0, options.findIndex((o) => o.id === envKey))}
            selectBoxOptions={{ ariaLabel: t('cookies.environment', 'Environment') }}
            onDidSelect={({ index }) => { setEnvKey(options[index]?.id ?? '') }}
            data-testid="cookie-manager-env-select"
          />
          <span className="cookie-manager-spacer" />
          <Button
            icon="clear-all"
            disabled={rows.length === 0}
            onClick={() => void clearAll()}
            options={{ ariaLabel: t('cookies.clearAll', 'Clear all cookies') }}
            data-testid="cookie-manager-clear-all"
          >
            {t('cookies.clearAll', 'Clear all')}
          </Button>
        </div>

        {rows.length === 0
          ? <p className="cookie-manager-empty" data-testid="cookie-manager-empty">{t('cookies.empty', 'No cookies stored for this environment yet.')}</p>
          : groups.map((group) => (
            <div className="cookie-manager-group" key={group.domain} data-testid={`cookie-manager-group-${group.domain}`}>
              <div className="cookie-manager-group-head">
                <span className="cookie-manager-group-domain">{group.domain}</span>
                <Button
                  icon="trash"
                  onClick={() => void clearDomain(group.domain)}
                  options={{ ariaLabel: t('cookies.clearOrigin', 'Clear cookies for {{domain}}', { domain: group.domain }) }}
                  data-testid={`cookie-manager-clear-origin-${group.domain}`}
                />
              </div>
              <table className="cookie-manager-table">
                <thead>
                  <tr>
                    <th>{t('cookies.column.name', 'Name')}</th>
                    <th>{t('cookies.column.value', 'Value')}</th>
                    <th>{t('cookies.column.path', 'Path')}</th>
                    <th>{t('cookies.column.expires', 'Expires')}</th>
                    <th>{t('cookies.column.flags', 'Flags')}</th>
                    <th aria-label={t('cookies.column.actions', 'Actions')} />
                  </tr>
                </thead>
                <tbody>
                  {group.cookies.map((c) => {
                    const id = rowId(c)
                    return (
                      <tr key={id} data-testid={`cookie-row-${c.domain}-${c.path}-${c.key}`}>
                        <td className="cookie-manager-name">{c.key}</td>
                        <td className="cookie-manager-value">
                          <InputBox
                            value={drafts[id] ?? c.value}
                            options={{ ariaLabel: t('cookies.valueOf', 'Value of {{name}}', { name: c.key }) }}
                            onChange={(next) => { setDrafts((d) => ({ ...d, [id]: next })) }}
                            data-testid={`cookie-value-${c.key}`}
                          />
                          {drafts[id] !== undefined && drafts[id] !== c.value && (
                            <Button icon="check" onClick={() => void saveValue(c)} options={{ ariaLabel: t('cookies.save', 'Save') }} />
                          )}
                        </td>
                        <td className="cookie-manager-muted">{c.path}</td>
                        <td className="cookie-manager-muted">
                          {c.expires === null ? t('cookies.session', 'Session') : formatExpires(c.expires, i18n.language)}
                        </td>
                        <td className="cookie-manager-flags">
                          {c.secure && <span className="cookie-manager-flag">Secure</span>}
                          {c.httpOnly && <span className="cookie-manager-flag">HttpOnly</span>}
                          {c.sameSite !== null && <span className="cookie-manager-flag">{`SameSite=${c.sameSite}`}</span>}
                        </td>
                        <td>
                          <Button
                            icon="trash"
                            onClick={() => void remove(c)}
                            options={{ ariaLabel: t('cookies.deleteNamed', 'Delete {{name}}', { name: c.key }) }}
                            data-testid={`cookie-delete-${c.key}`}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))}

        <div className="cookie-manager-add" data-testid="cookie-manager-add">
          <InputBox value={newKey} changeDebounceMs={0} options={{ placeholder: t('cookies.column.name', 'Name') }} onChange={setNewKey} data-testid="cookie-add-name" />
          <InputBox value={newValue} changeDebounceMs={0} options={{ placeholder: t('cookies.column.value', 'Value') }} onChange={setNewValue} data-testid="cookie-add-value" />
          <InputBox value={newDomain} changeDebounceMs={0} options={{ placeholder: t('cookies.column.domain', 'Domain') }} onChange={setNewDomain} data-testid="cookie-add-domain" />
          <InputBox value={newPath} changeDebounceMs={0} options={{ placeholder: t('cookies.column.path', 'Path') }} onChange={setNewPath} data-testid="cookie-add-path" />
          <Button disabled={!newKey.trim() || !newDomain.trim()} onClick={() => void addCookie()} data-testid="cookie-add-submit">
            {t('cookies.add', 'Add')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
