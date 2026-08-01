import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconView } from 'electron-core-ui/renderer'
import { useItemSecretStatus } from '../../services/secretItemStatusStore'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'
import './SecretErrorIndicator.css'

const SECRET_ERROR_ICON = { type: 'phosphor', value: 'ExclamationMark' } as const

export interface ItemSecretBadgesProps {
  /** The tree item (request of any protocol / scenario) whose effective secret
   * status drives the badges. */
  itemId: string | null | undefined
  'data-testid'?: string
}

/**
 * The per-item secret badges: a spinner while the item is resolving a secret
 * (its OWN direct secret, or one of its active environment's), and a red error
 * glyph when its last resolution failed. Renders nothing when healthy, so it
 * drops inline next to a label (tab title, sidebar row, scenario node header)
 * without reserving space. One signal, identical on every surface.
 */
export const ItemSecretBadges: React.FC<ItemSecretBadgesProps> = ({ itemId, 'data-testid': dataTestId }) => {
  const { t } = useTranslation()
  const { resolving, error, errorVars } = useItemSecretStatus(itemId)
  if (!resolving && !error) return null
  return (
    <>
      {resolving && (
        <i
          className="codicon codicon-loading codicon-modifier-spin"
          role="status"
          aria-label={t('secrets.resolving', 'Résolution…')}
          style={{ fontSize: 13, opacity: 0.8, flex: '0 0 auto' }}
          {...(dataTestId ? { 'data-testid': `${dataTestId}-resolving` } : {})}
        />
      )}
      {error && !resolving && (
        <HeaderHoverTooltip
          label={
            // Name the failing variables when the failure is inherited: one
            // unresolvable variable badges every request that references it,
            // and the generic wording reads as N independent breakages.
            errorVars.length > 0
              ? t('secrets.resolveErrorItemVars', {
                  defaultValue: "Variable(s) d'environnement non résolue(s) : {{vars}}",
                  vars: errorVars.join(', ')
                })
              : t('secrets.resolveErrorItem', "Au moins un secret de cet élément n'a pas pu être récupéré.")
          }
        >
          <span
            className="secret-error-indicator"
            role="img"
            aria-label={t('secrets.resolveError', 'Échec de résolution du secret')}
            {...(dataTestId ? { 'data-testid': `${dataTestId}-error` } : {})}
          >
            <IconView icon={SECRET_ERROR_ICON} size={14} />
          </span>
        </HeaderHoverTooltip>
      )}
    </>
  )
}

export default ItemSecretBadges
