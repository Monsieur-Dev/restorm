/**
 * Wraps `RestormWorkbenchTab` with a live deprecation lookup driven
 * by the URL → operation matcher (same matcher that powers the Docs
 * tab visibility). When the matched operation is flagged
 * `deprecated` in the spec, an orange callout appears under the
 * breadcrumb. Editing the URL to a non-deprecated route — or to one
 * that doesn't match any operation — clears the callout
 * immediately, since the decision is recomputed on every URL
 * change rather than read off a persisted flag.
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { RestormWorkbenchTab, type RestormWorkbenchTabProps } from './RestormWorkbenchTab'
import { useCompiledDocumentation } from '../../../hooks/useCompiledDocumentation'
import type { Request } from '../../../../../shared/types/collections'

export interface DeprecationAwareRequestTabProps extends Omit<RestormWorkbenchTabProps, 'callout'> {
  request: Request
}

export const DeprecationAwareRequestTab: React.FC<DeprecationAwareRequestTabProps> = ({
  request,
  children,
  ...rest
}) => {
  const { t } = useTranslation()
  const { deprecated } = useCompiledDocumentation(request)
  const callout = deprecated
    ? { variant: 'warning' as const, message: t('requestTab.deprecated') }
    : undefined
  return (
    <RestormWorkbenchTab {...rest} {...(callout ? { callout } : {})}>
      {children}
    </RestormWorkbenchTab>
  )
}
