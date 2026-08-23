/**
 * Cookie jar — the global workbench tab that shows every stored cookie, one
 * jar per environment. Master-detail: an environment treeview on the left
 * (Root "No environment" → env-folders → environments / sub-environments, each
 * with its chosen icon) and, on the right, the cookie table for the selected
 * environment (edit a value, delete, clear an origin or the whole jar, add a
 * cookie by hand).
 *
 * Live: it re-reads on `cookies:changed` (a request captured a Set-Cookie, or a
 * jar mutation happened) and on `FOLDER_UPDATED` (an environment was renamed,
 * re-iconed or deleted — the tree follows, and a deleted env drops its jar).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, IconView, Modal, ScrollableElement, StaticPane, eventBus } from 'electron-core-ui/renderer'
import type { Icon } from 'electron-core-ui/types'
import type { CookieInput, CookieRow } from '../../../../shared/cookies/cookieTypes'
import { useAllEnvironments } from '../../hooks/useAllEnvironments'
import { DEFAULT_ENV_COLOR } from '../MainView/envSelectorHelpers'
import { DocumentEvents } from '../../services/DocumentEvents'
import { CookieAddModal } from './CookieAddModal'
import './CookieJarPanel.css'

export interface CookieJarPanelProps {
  /** Origin to surface first (from a response chip) — selects the jar that
   * holds it and scrolls its group into view. */
  focusDomain?: string
}

/** A node in the environment treeview. `envKey` is the jar key: '' for the
 * root "No environment" pot, or the environment id. */
interface TreeNode {
  envKey: string
  label: string
  depth: number
  icon?: Icon
  /** The environment's own colour (for the tinted icon badge). */
  color?: string
  isFolderHeader?: boolean
}

/** The env-folder icon, matching the sidebar / env-folder tab. */
const ENV_FOLDER_ICON: Icon = { type: 'codicon', value: 'folder-library' }

/** Stable identity of a cookie within a jar (domain + path + name). */
function rowId(c: CookieRow): string {
  return `${c.domain}\t${c.path}\t${c.key}`
}

function formatExpires(iso: string | null, locale: string): string {
  if (iso === null) return ''
  return new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
}

export function CookieJarPanel({ focusDomain }: CookieJarPanelProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const environments = useAllEnvironments()

  // Build the treeview: Root ("No environment") first, then every env grouped
  // by its owning env-folder, indented by depth (sub-environments included).
  const tree = useMemo<TreeNode[]>(() => {
    const nodes: TreeNode[] = [{ envKey: '', label: t('cookies.noEnvironment', 'No environment'), depth: 0 }]
    let lastGroup: string | undefined
    for (const row of environments) {
      if (row.groupLabel !== undefined && row.groupLabel !== lastGroup) {
        lastGroup = row.groupLabel
        nodes.push({ envKey: `folder:${row.groupLabel}`, label: row.groupLabel, depth: 0, isFolderHeader: true })
      }
      nodes.push({
        envKey: row.env.id,
        label: row.env.name,
        depth: row.depth + (row.groupLabel !== undefined ? 1 : 0),
        ...(row.env.icon ? { icon: row.env.icon } : {}),
        ...(row.env.color ? { color: row.env.color } : {})
      })
    }
    return nodes
  }, [environments, t])

  const [selectedKey, setSelectedKey] = useState('')
  const [rows, setRows] = useState<CookieRow[]>([])
  // Add-cookie modal (opened from the global "+" or a per-origin "+"). `addSeq`
  // bumps on every open so the modal remounts fresh (no reset effect).
  const [addOpen, setAddOpen] = useState(false)
  const [addDomain, setAddDomain] = useState<string | undefined>(undefined)
  const [editCookie, setEditCookie] = useState<CookieRow | undefined>(undefined)
  const [addSeq, setAddSeq] = useState(0)
  // Confirmation dialog for the destructive actions (delete / clear) and for
  // overwriting an existing cookie at the same place. `okLabel` overrides the
  // default "Delete" button label (e.g. "Replace").
  const [confirm, setConfirm] = useState<{ message: string; run: () => void; okLabel?: string } | null>(null)
  // Domains whose pane is collapsed (StaticPane has no built-in collapse — we
  // drive it here so the panes hug their content and the list scrolls).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggleCollapsed = useCallback((domain: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(domain)) next.delete(domain)
      else next.add(domain)
      return next
    })
  }, [])

  // The selected jar key, snapped back to Root when the chosen env was deleted
  // (derived, not stored — deleting an env drops its jar and the view follows).
  const activeKey = useMemo(
    () => (selectedKey === '' || environments.some((r) => r.env.id === selectedKey) ? selectedKey : ''),
    [selectedKey, environments]
  )

  const refresh = useCallback(() => {
    let cancelled = false
    void window.api.cookies.list(activeKey).then((next) => { if (!cancelled) setRows(next) })
    return () => { cancelled = true }
  }, [activeKey])

  useEffect(() => refresh(), [refresh])

  // Live refresh: the main process pushes `cookie:changed` after every jar
  // mutation (a request captured a Set-Cookie, or a UI add/remove/clear). The
  // renderer-local eventBus is kept as a secondary channel.
  useEffect(() => window.api.cookies.onChanged(() => { refresh() }), [refresh])
  useEffect(() => {
    const sub = eventBus.subscribe(DocumentEvents.COOKIES_CHANGED, () => { refresh() })
    return () => { sub.unsubscribe() }
  }, [refresh])

  // Pre-select the jar that holds the focus origin (from a response chip).
  useEffect(() => {
    if (focusDomain === undefined) return
    let cancelled = false
    void window.api.cookies.list('').then((list) => {
      if (cancelled) return
      if (list.some((c) => c.domain === focusDomain || focusDomain.endsWith(c.domain.replace(/^\./, '')))) setSelectedKey('')
    })
    return () => { cancelled = true }
  }, [focusDomain])

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

  async function remove(c: CookieRow): Promise<void> { setRows(await window.api.cookies.remove(activeKey, c.domain, c.path, c.key)) }
  async function clearDomain(domain: string): Promise<void> { setRows(await window.api.cookies.clearDomain(activeKey, domain)) }
  async function clearAll(): Promise<void> { setRows(await window.api.cookies.clear(activeKey)) }
  function openAdd(domain?: string): void { setEditCookie(undefined); setAddDomain(domain); setAddSeq((s) => s + 1); setAddOpen(true) }
  function openEdit(c: CookieRow): void { setEditCookie(c); setAddDomain(undefined); setAddSeq((s) => s + 1); setAddOpen(true) }

  // Persist a cookie from the add/edit modal. Renaming an edited cookie (its
  // name / domain / path changed) removes the old entry. Writing over another
  // cookie that already sits at the same place asks first — the jar keys by
  // (name, domain, path), so the write would silently replace it.
  const submitCookie = useCallback((input: CookieInput, original: CookieRow | undefined): void => {
    const bare = (d: string): string => d.replace(/^\./, '')
    const targetPath = input.path === undefined || input.path === '' ? '/' : input.path
    const isOriginal = (r: CookieRow): boolean => r.key === original?.key && r.path === original.path && r.domain === original.domain
    const renamed = original !== undefined && (original.key !== input.key || original.path !== targetPath || bare(original.domain) !== bare(input.domain))
    // The old entry to delete when an edit renamed the cookie (set ⇒ renamed).
    const stale = renamed ? original : undefined
    const collision = rows.find(
      (r) => r.key === input.key && r.path === targetPath && bare(r.domain) === bare(input.domain) && !isOriginal(r)
    )
    const run = async (): Promise<void> => {
      if (stale !== undefined) await window.api.cookies.remove(activeKey, stale.domain, stale.path, stale.key)
      setRows(await window.api.cookies.add(activeKey, input))
    }
    if (collision !== undefined) {
      setConfirm({
        message: t('cookies.confirmReplace', 'A cookie named "{{name}}" already exists here. Replace it?', { name: input.key }),
        okLabel: t('cookies.replaceButton', 'Replace'),
        run: () => { void run() }
      })
    } else {
      void run()
    }
  }, [rows, activeKey, t])

  const selectedLabel = tree.find((n) => n.envKey === activeKey)?.label ?? t('cookies.noEnvironment', 'No environment')

  return (
    <div className="cookie-jar" data-testid="cookie-jar">
      <ScrollableElement className="cookie-jar-tree" options={{ vertical: 'auto', horizontal: 'hidden' }}>
       <div className="cookie-jar-tree-inner" data-testid="cookie-jar-tree">
        {tree.map((node) =>
          node.isFolderHeader ? (
            <div key={node.envKey} className="cookie-jar-tree-folder" style={{ paddingLeft: 8 + node.depth * 16 }}>
              <IconView icon={ENV_FOLDER_ICON} size={14} />
              <span>{node.label}</span>
            </div>
          ) : (
            <button
              key={node.envKey}
              type="button"
              className={`cookie-jar-tree-node${activeKey === node.envKey ? ' selected' : ''}`}
              style={{ paddingLeft: 8 + node.depth * 16 }}
              data-testid={`cookie-jar-tree-node-${node.envKey || 'root'}`}
              onClick={() => { setSelectedKey(node.envKey) }}
            >
              {node.envKey === '' ? (
                <IconView icon={{ type: 'codicon', value: 'globe' }} size={14} />
              ) : (
                // An environment renders its own icon in a badge tinted with its
                // own colour — exactly like the env selector / env-folder editor.
                <span
                  className="cookie-jar-env-badge"
                  style={{
                    background: `color-mix(in srgb, ${node.color ?? DEFAULT_ENV_COLOR} 18%, transparent)`,
                    color: node.color ?? DEFAULT_ENV_COLOR
                  }}
                >
                  {node.icon ? <IconView icon={node.icon} size={13} /> : null}
                </span>
              )}
              <span className="cookie-jar-tree-node-label">{node.label}</span>
            </button>
          )
        )}
       </div>
      </ScrollableElement>

      <div className="cookie-jar-detail" data-testid="cookie-jar-detail">
        <div className="cookie-jar-detail-head">
          <span className="cookie-jar-detail-title">{selectedLabel}</span>
          <span className="cookie-jar-spacer" />
          <Button
            secondary
            icon="clear-all"
            disabled={rows.length === 0}
            onClick={() => { setConfirm({ message: t('cookies.confirmClearAll', 'Delete every cookie in this environment?'), run: () => { void clearAll() } }) }}
            options={{ ariaLabel: t('cookies.clearAll', 'Clear all cookies') }}
            data-testid="cookie-jar-clear-all"
          >
            {t('cookies.clearAll', 'Clear all')}
          </Button>
          <Button
            small
            icon="add"
            onClick={() => { openAdd() }}
            options={{ ariaLabel: t('cookies.addTitle', 'Add a cookie') }}
            data-testid="cookie-jar-add-global"
          />
        </div>

        {rows.length === 0 ? (
          <div className="cookie-jar-detail-body">
            <p className="cookie-jar-empty" data-testid="cookie-jar-empty">{t('cookies.empty', 'No cookies stored for this environment yet.')}</p>
          </div>
        ) : (
          <ScrollableElement className="cookie-jar-panes-scroll" options={{ vertical: 'auto', horizontal: 'auto' }}>
            <div className="cookie-jar-panes" data-testid="cookie-jar-panes">
              {groups.map((group) => {
                const isCollapsed = collapsed.has(group.domain)
                return (
                  <StaticPane
                    key={group.domain}
                    className={`cookie-jar-pane${isCollapsed ? ' collapsed' : ''}`}
                    data-testid={`cookie-jar-group-${group.domain}`}
                    title={
                      <button
                        type="button"
                        className="cookie-jar-pane-toggle"
                        onClick={() => { toggleCollapsed(group.domain) }}
                        aria-expanded={!isCollapsed}
                        data-testid={`cookie-jar-toggle-${group.domain}`}
                      >
                        <span className={`codicon codicon-chevron-${isCollapsed ? 'right' : 'down'}`} aria-hidden="true" />
                        <span className="cookie-jar-pane-domain">{group.domain}</span>
                      </button>
                    }
                    headerActions={
                      <>
                        <Button
                          small
                          secondary
                          icon="add"
                          onClick={() => { if (isCollapsed) toggleCollapsed(group.domain); openAdd(group.domain) }}
                          options={{ ariaLabel: t('cookies.addForOrigin', 'Add a cookie for {{domain}}', { domain: group.domain }) }}
                          data-testid={`cookie-jar-add-origin-${group.domain}`}
                        />
                        <Button
                          small
                          secondary
                          icon="trash"
                          onClick={() => { setConfirm({ message: t('cookies.confirmClearOrigin', 'Delete all cookies for {{domain}}?', { domain: group.domain }), run: () => { void clearDomain(group.domain) } }) }}
                          options={{ ariaLabel: t('cookies.clearOrigin', 'Clear cookies for {{domain}}', { domain: group.domain }) }}
                          data-testid={`cookie-jar-clear-origin-${group.domain}`}
                        />
                      </>
                    }
                  >
                    {!isCollapsed && (
                      <table className="cookie-jar-table">
                        <colgroup>
                          <col className="cj-col-name" />
                          <col className="cj-col-path" />
                          <col className="cj-col-expires" />
                          <col className="cj-col-flags" />
                          <col className="cj-col-value" />
                          <col className="cj-col-actions" />
                        </colgroup>
                        <thead>
                          <tr>
                            <th>{t('cookies.column.name', 'Name')}</th>
                            <th>{t('cookies.column.path', 'Path')}</th>
                            <th>{t('cookies.column.expires', 'Expires')}</th>
                            <th>{t('cookies.column.flags', 'Flags')}</th>
                            <th>{t('cookies.column.value', 'Value')}</th>
                            <th aria-label={t('cookies.column.actions', 'Actions')} />
                          </tr>
                        </thead>
                        <tbody>
                          {group.cookies.map((c) => {
                            const id = rowId(c)
                            return (
                              <tr key={id} data-testid={`cookie-row-${c.domain}-${c.path}-${c.key}`}>
                                <td className="cookie-jar-name cookie-jar-selectable">{c.key}</td>
                                <td className="cookie-jar-muted cookie-jar-selectable">{c.path}</td>
                                <td className="cookie-jar-muted cookie-jar-selectable">{c.expires === null ? t('cookies.session', 'Session') : formatExpires(c.expires, i18n.language)}</td>
                                <td className="cookie-jar-flags">
                                  {c.secure && <span className="cookie-jar-flag">Secure</span>}
                                  {c.httpOnly && <span className="cookie-jar-flag">HttpOnly</span>}
                                  {c.sameSite !== null && <span className="cookie-jar-flag">{`SameSite=${c.sameSite}`}</span>}
                                </td>
                                <td className="cookie-jar-value">
                                  <span className="cookie-jar-value-text" data-testid={`cookie-value-${c.key}`}>{c.value}</span>
                                </td>
                                <td className="cookie-jar-actions-cell">
                                  <span className="cookie-jar-row-actions">
                                    <Button small icon="edit" onClick={() => { openEdit(c) }} options={{ ariaLabel: t('cookies.editNamed', 'Edit {{name}}', { name: c.key }) }} data-testid={`cookie-edit-${c.key}`} />
                                    <Button small icon="trash" onClick={() => { setConfirm({ message: t('cookies.confirmDelete', 'Delete the cookie "{{name}}"?', { name: c.key }), run: () => { void remove(c) } }) }} options={{ ariaLabel: t('cookies.deleteNamed', 'Delete {{name}}', { name: c.key }) }} data-testid={`cookie-delete-${c.key}`} />
                                  </span>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    )}
                  </StaticPane>
                )
              })}
            </div>
          </ScrollableElement>
        )}
      </div>

      <CookieAddModal
        key={addSeq}
        isOpen={addOpen}
        onClose={() => { setAddOpen(false) }}
        {...(addDomain !== undefined ? { initialDomain: addDomain } : {})}
        {...(editCookie !== undefined ? { initialCookie: editCookie } : {})}
        onSubmit={submitCookie}
      />

      <Modal
        title={t('cookies.confirmTitle', 'Confirm')}
        isOpen={confirm !== null}
        onClose={() => { setConfirm(null) }}
        size="dialog"
        enterActionTestId="cookie-jar-confirm-ok"
      >
        <div className="cookie-jar-confirm" data-testid="cookie-jar-confirm">
          <p className="cookie-jar-confirm-message">{confirm?.message}</p>
          <div className="cookie-jar-confirm-actions">
            <Button secondary onClick={() => { setConfirm(null) }} data-testid="cookie-jar-confirm-cancel">{t('cookies.cancel', 'Cancel')}</Button>
            <Button onClick={() => { confirm?.run(); setConfirm(null) }} data-testid="cookie-jar-confirm-ok">{confirm?.okLabel ?? t('cookies.deleteButton', 'Delete')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
