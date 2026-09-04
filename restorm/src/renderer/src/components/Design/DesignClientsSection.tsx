import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Button, ListView, ScrollableElement, type ListViewItemData } from 'electron-core-ui/renderer'
import type { ApiDesign, Request } from '../../../../shared/types/collections'
import { httpBadgeIdFor, isKnownHttpMethod } from '../../../../shared/utils/httpMethod'
import { resolveUrlAgainstEnv, flattenEnvVars } from '../../../../shared/utils/resolveUrlAgainstEnv'
import { RegistryBadge } from '../common/RegistryBadge'
import { Badge } from '../common/Badge'
import { mapToBadgeType, requestBadgeId } from '../../utils/badgeUtils'
import { useIsDesignServerListening } from '../../services/designServerStore'
import {
  useDesignClients,
  generateDesignClients,
  findClientRequest,
  parseDesignClientRowId,
  openDesignClientTab,
  getDesignClientsDeprecatedIds,
  designClientBreadcrumbSegments,
  designClientRowId
} from '../../services/designClientsStore'
import { designSectionRowId } from '../../../../shared/design/designSections'
import { designClientsChildren } from '../../services/FolderToListView'
import { designDescriptors } from '../../services/designDescriptors'
import { DesignDescriptorAccordions } from './DesignDescriptorAccordions'
import { useDesignEnvVariables } from '../../hooks/useDesignEnvVariables'
import { setPendingDesignSection } from '../../services/designSectionIntent'

/**
 * The Clients section, shown in the design tab's right pane. While the design
 * is served it exposes ready-to-run client requests — one folder per served
 * protocol, imported live from the mock's own metadata (dogfood). Here we show,
 * full-width, the SAME tree the left sidebar renders (protocol → request rows
 * with a badge), each row annotated with its description in grey. Stopping the
 * server clears the clients (and their tabs).
 */
export const DesignClientsSection: React.FC<{ design: ApiDesign; scopeId?: string | null }> = ({ design, scopeId = null }) => {
  const { t } = useTranslation()
  const serving = useIsDesignServerListening(design.id)
  const clients = useDesignClients(design.id)
  // Rows are expanded by default; a collapsed set (empty = all open) tracks the
  // user's toggles so a re-render doesn't snap folders back open.
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(() => new Set())

  const refresh = useCallback(async () => {
    const status = await window.restorm?.designServer.status(design.id)
    if (status?.listening === true && status.port !== undefined) {
      await generateDesignClients(design, status.port)
    }
  }, [design])

  // Ports of the running server — for the descriptor URLs. Re-read when clients
  // (re)generate, since the gRPC projection binds its port asynchronously. Only
  // the async result writes state; the descriptors memo gates on `serving`.
  const [serverPorts, setServerPorts] = useState<{ port: number; grpcPort?: number } | null>(null)
  useEffect(() => {
    if (!serving) return
    let cancelled = false
    void window.restorm?.designServer.status(design.id).then((status) => {
      if (cancelled || !status.listening || status.port === undefined) return
      setServerPorts(status.grpcPort !== undefined ? { port: status.port, grpcPort: status.grpcPort } : { port: status.port })
    })
    return () => { cancelled = true }
  }, [serving, design.id, clients])

  const envVariables = useDesignEnvVariables(design.id)
  const descriptors = useMemo(() => {
    if (!serving || serverPorts === null) return []
    const envMap = flattenEnvVars(Object.fromEntries(envVariables.map((v) => [v.name, v.value])))
    const resolvedBasePath = resolveUrlAgainstEnv(design.server?.basePath ?? '', envMap)
    return designDescriptors(design, serverPorts.port, serverPorts.grpcPort, resolvedBasePath)
  }, [design, serverPorts, envVariables, serving])

  const goToServer = useCallback(() => { setPendingDesignSection(design.id, 'server') }, [design.id])

  // The exact badge renderers the sidebar uses, so the page tree reads identically.
  const rows = useMemo<ListViewItemData[]>(() => {
    // `designClientsChildren` reads the client store directly; touch `clients`
    // so the tree rebuilds when the bundles (re)generate or clear.
    void clients
    const base = designClientsChildren(design, {
      expandedIds: new Set(),
      renderMethodBadge: (method: string) => <RegistryBadge badgeId={httpBadgeIdFor(method)} text={method} />,
      renderProtocolBadge: (protocol: string, label?: string, mode?: 'client' | 'server') =>
        (mode === 'server' && isKnownHttpMethod(protocol))
          ? <RegistryBadge badgeId={httpBadgeIdFor(protocol)} text={label ?? protocol} server />
          : <Badge type={mapToBadgeType(protocol)} label={label} mode={mode} />,
      renderRequestBadge: (request: Request) => <RegistryBadge badgeId={requestBadgeId(request)} />,
      // Dim deprecated client rows in the central tree too (same set + wrapper
      // as the sidebar), so a deprecated route reads as dimmed everywhere.
      deprecatedRequestIds: getDesignClientsDeprecatedIds()
    })
    // Force the default-open state and append each leaf's description in grey.
    const decorate = (items: ListViewItemData[]): ListViewItemData[] =>
      items.map((row) => {
        if (row.children && row.children.length > 0) {
          return { ...row, isExpanded: !collapsedIds.has(row.id), children: decorate(row.children) }
        }
        const parsed = parseDesignClientRowId(row.id)
        const req = parsed ? findClientRequest(parsed.designId, parsed.itemId) : undefined
        const desc = (req as { notes?: string } | undefined)?.notes?.trim()
        if (desc === undefined || desc === '') return row
        return {
          ...row,
          title: (
            <span className="design-clients-row">
              <span className="design-clients-row-op">{row.title}</span>
              <span className="design-clients-row-desc">{desc}</span>
            </span>
          )
        }
      })
    return decorate(base)
    // clients is the reactive trigger — the tree rebuilds when they (re)generate.
  }, [design, clients, collapsedIds])

  // When scoped to one client folder, show only its CHILD tree (the folder node
  // itself drops out) and — for a protocol root — only that protocol's
  // descriptor. A stale/absent scope falls back to the full view.
  const scope = useMemo(() => {
    if (scopeId === null) return null
    const find = (items: ListViewItemData[]): ListViewItemData | null => {
      for (const item of items) {
        if (item.id === scopeId) return item
        if (item.children) {
          const hit = find(item.children)
          if (hit !== null) return hit
        }
      }
      return null
    }
    const node = find(rows)
    if (node === null) return null
    const scopeItemId = parseDesignClientRowId(scopeId)?.itemId
    const protocol = scopeItemId?.startsWith('proto:') === true ? scopeItemId.slice('proto:'.length) : null
    return { title: node.title, rows: node.children ?? [], protocol }
  }, [scopeId, rows])

  const displayRows = scope !== null ? scope.rows : rows
  const displayDescriptors = scope !== null
    ? (scope.protocol !== null ? descriptors.filter((d) => d.protocol === scope.protocol) : [])
    : descriptors

  const openRow = useCallback((rowId: string) => {
    const parsed = parseDesignClientRowId(rowId)
    if (parsed === null) return
    const req = findClientRequest(parsed.designId, parsed.itemId)
    if (req === undefined) return // a folder row — the ListView toggles it instead
    // Breadcrumb mirrors the sidebar: Design / Clients / <protocol> / <folder…>
    // (the route itself is the tab title, so it is not repeated as a crumb).
    const crumbs: { id: string; label: string }[] = [
      { id: `design-client-root:${design.id}`, label: design.name },
      { id: designSectionRowId(design.id, 'clients'), label: t('design.section.clients', 'Clients') }
    ]
    const segs = designClientBreadcrumbSegments(rowId)
    if (segs !== null) {
      crumbs.push({ id: designClientRowId(design.id, `proto:${segs.protocol}`), label: t(`design.protocol.${segs.protocol}`) })
      for (const folder of segs.folders) crumbs.push({ id: designClientRowId(design.id, folder.id), label: folder.name })
    }
    // The workbench tab uses the LAST crumb as its title, so the route itself
    // is the final crumb (its name becomes the title; the folders above stay
    // the clickable path).
    crumbs.push({ id: rowId, label: (req as { name: string }).name })
    openDesignClientTab(req, crumbs, rowId)
  }, [design.id, design.name, t])

  const onToggle = useCallback((rowId: string, expanded: boolean) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      if (expanded) next.delete(rowId)
      else next.add(rowId)
      return next
    })
  }, [])

  if (!serving) {
    return (
      <div className="design-clients-empty" data-testid="design-clients-empty">
        <p className="design-clients-empty-text">
          <Trans
            i18nKey="design.clients.startServerPrompt"
            t={t}
            defaults="Start the <serverLink>design server</serverLink> to access client requests auto-generated from the model."
            components={{
              serverLink: (
                <button
                  type="button"
                  className="design-clients-server-link"
                  onClick={goToServer}
                  data-testid="design-clients-server-link"
                />
              )
            }}
          />
        </p>
      </div>
    )
  }

  return (
    <ScrollableElement className="design-section-scroll">
      <div className="design-section design-clients" data-testid="design-clients-section">
        <div className="design-clients-live-head">
          {scope !== null
            ? <p className="design-section-subtitle design-clients-scope" data-testid="design-clients-scope">{scope.title}</p>
            : (
              <p className="design-section-subtitle">
                {t('design.clients.subtitle', 'Ready-to-run client requests for every protocol this design serves.')}
              </p>
            )}
          <Button
            secondary
            icon="refresh"
            onClick={() => { void refresh() }}
            options={{ ariaLabel: t('design.clients.refresh', 'Regenerate the clients') }}
            data-testid="design-clients-refresh"
          />
        </div>

        <DesignDescriptorAccordions descriptors={displayDescriptors} />

        {clients.length > 0 ? (
          <div className="design-clients-tree" data-testid="design-clients-tree">
            <ListView
              items={displayRows}
              rootRole="tree"
              ariaLabel={t('design.section.clients', 'Clients')}
              disableDrag
              onItemClick={(payload) => { openRow(payload.item.id) }}
              onItemToggle={(payload, expanded) => { onToggle(payload.item.id, expanded) }}
              data-testid="design-clients-listview"
            />
          </div>
        ) : (
          <p className="design-clients-importing" data-testid="design-clients-importing">
            {t('design.clients.importing', 'Importing clients…')}
          </p>
        )}
      </div>
    </ScrollableElement>
  )
}
