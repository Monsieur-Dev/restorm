import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconView } from 'electron-core-ui/renderer'
import { useAnyEnvError } from '../../services/secretErrorStore'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'
import './SecretErrorIndicator.css'

/** The shared secret-error glyph: a Phosphor exclamation mark, red. */
const SECRET_ERROR_ICON = { type: 'phosphor', value: 'ExclamationMark' } as const

export interface SecretErrorIndicatorProps {
  /** Environment id(s) whose secret-resolution error state drives the badge. Pass
   * an env-folder's full env-id list for a folder-level badge, or a single id. */
  environmentIds: readonly string[]
  style?: React.CSSProperties
  'data-testid'?: string
}

/**
 * A small error glyph shown when AT LEAST ONE of the given environments last
 * FAILED to resolve a secret variable (e.g. a missing env var). Renders nothing
 * otherwise, so it can be dropped inline next to a label (env tab, env-folder
 * sidebar entry, the Environnements sub-tab, an environment list row) — the same
 * places as the resolving spinner — without reserving space when healthy.
 */
export const SecretErrorIndicator: React.FC<SecretErrorIndicatorProps> = ({
  environmentIds,
  style,
  'data-testid': dataTestId
}) => {
  const { t } = useTranslation()
  const hasError = useAnyEnvError(environmentIds)
  if (!hasError) return null
  return (
    <HeaderHoverTooltip
      label={t(
        'secrets.resolveErrorEnv',
        "Au moins une variable n'a pas pu être récupérée et est en erreur."
      )}
    >
      <span
        className="secret-error-indicator"
        role="img"
        aria-label={t('secrets.resolveError', 'Échec de résolution du secret')}
        style={style}
        {...(dataTestId ? { 'data-testid': dataTestId } : {})}
      >
        <IconView icon={SECRET_ERROR_ICON} size={14} />
      </span>
    </HeaderHoverTooltip>
  )
}
