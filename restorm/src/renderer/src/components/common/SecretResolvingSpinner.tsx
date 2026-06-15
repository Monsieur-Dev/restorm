import React from 'react'
import { useTranslation } from 'react-i18next'
import { useAnyEnvResolving } from '../../services/secretResolutionStore'

export interface SecretResolvingSpinnerProps {
  /** Environment id(s) whose secret-resolution state drives the spinner. Pass an
   * env-folder's full env-id list for a folder-level spinner, or a single id. */
  environmentIds: readonly string[]
  style?: React.CSSProperties
  'data-testid'?: string
}

/**
 * A small spinning glyph shown while AT LEAST ONE of the given environments is
 * resolving a secret variable. Renders nothing otherwise, so it can be dropped
 * inline next to a label (env tab, env-folder sidebar entry, the Environnements
 * sub-tab, an environment list row) without reserving space when idle.
 */
export const SecretResolvingSpinner: React.FC<SecretResolvingSpinnerProps> = ({
  environmentIds,
  style,
  'data-testid': dataTestId
}) => {
  const { t } = useTranslation()
  const resolving = useAnyEnvResolving(environmentIds)
  if (!resolving) return null
  return (
    <i
      className="codicon codicon-loading codicon-modifier-spin"
      role="status"
      aria-label={t('secrets.resolving', 'Résolution…')}
      style={{ fontSize: 13, opacity: 0.8, flex: '0 0 auto', ...style }}
      {...(dataTestId ? { 'data-testid': dataTestId } : {})}
    />
  )
}

export default SecretResolvingSpinner
