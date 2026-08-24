import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, ScrollableElement } from 'electron-core-ui/renderer'
import type { ApiDesign, FolderItem } from '../../../../shared/types/collections'
import { useIsDesignServerListening } from '../../services/designServerStore'
import { useDesignClients, generateDesignClients } from '../../services/designClientsStore'

function countRequests(items: FolderItem[]): number {
  let n = 0
  for (const item of items) {
    const children = (item as { items?: FolderItem[] }).items
    if (Array.isArray(children)) n += countRequests(children)
    else n += 1
  }
  return n
}

/**
 * The Clients section: while the design is served, it exposes ready-to-run
 * client requests — one folder per served protocol — imported live from the
 * mock's own metadata endpoints (dogfood). They are TEMPORARY: never written
 * to the .restorm file, and they vanish (with their tabs) when the server
 * stops. Until then this page just invites the user to start the server.
 */
export const DesignClientsSection: React.FC<{ design: ApiDesign }> = ({ design }) => {
  const { t } = useTranslation()
  const serving = useIsDesignServerListening(design.id)
  const clients = useDesignClients(design.id)

  const refresh = useCallback(async () => {
    const status = await window.restorm?.designServer.status(design.id)
    if (status?.listening === true && status.port !== undefined) {
      await generateDesignClients(design, status.port)
    }
  }, [design])

  return (
    <ScrollableElement className="design-section-scroll">
      <div className="design-section design-clients" data-testid="design-clients-section">
        <p className="design-section-subtitle">
          {t('design.clients.subtitle', 'Ready-to-run client requests for every protocol this design serves.')}
        </p>

        {serving ? (
          <div className="design-clients-live" data-testid="design-clients-live">
            <div className="design-clients-live-head">
              <p className="design-clients-hint">
                {t('design.clients.generated', 'Clients generated — open them under Clients in the sidebar.')}
              </p>
              <Button
                secondary
                icon="refresh"
                onClick={() => { void refresh() }}
                options={{ ariaLabel: t('design.clients.refresh', 'Regenerate the clients') }}
                data-testid="design-clients-refresh"
              />
            </div>
            {clients.length > 0 ? (
              <ul className="design-clients-bundles">
                {clients.map((bundle) => (
                  <li key={bundle.protocol} className="design-clients-bundle" data-testid={`design-clients-bundle-${bundle.protocol}`}>
                    <span className="design-clients-bundle-protocol">{t(`design.protocol.${bundle.protocol}`)}</span>
                    <span className="design-clients-bundle-count">{countRequests(bundle.items)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="design-clients-importing" data-testid="design-clients-importing">
                {t('design.clients.importing', 'Importing clients…')}
              </p>
            )}
          </div>
        ) : (
          <div className="design-clients-empty" data-testid="design-clients-empty">
            <span className="codicon codicon-debug-start design-clients-empty-icon" aria-hidden="true" />
            <p className="design-clients-empty-text">
              {t('design.clients.startPrompt', 'Start the server to generate the clients.')}
            </p>
          </div>
        )}
      </div>
    </ScrollableElement>
  )
}
