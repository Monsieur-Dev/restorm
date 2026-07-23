/**
 * AuthenticationConfigurationTab — the extra "Configuration" tab
 * that surfaces only for requests of type `auth`. Three sections:
 *
 * * **Produced headers** — `KeyValueTable` (via RestormKeyValueTable)
 *   where each `value` is authored with VariableInputBox. Each entry
 *   is a Handlebars expression evaluated against the most recent
 *   auth response at send time.
 * * **Expiration (seconds)** — a single VariableInputBox holding the
 *   handlebars expression that yields the TTL.
 * * **Auth error codes** — a comma-separated list of HTTP status
 *   codes that should trigger a cache invalidation + one retry on
 *   downstream requests. Defaults to `401, 403`.
 */

import React, { useCallback, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, InputBox, fieldDiffStyle } from 'electron-core-ui/renderer'
import type { AuthenticationRequest, KeyValue } from '../../../../shared/types/collections'
import { RestormKeyValueTable, type KeyValueTableHandle } from '../RestormKeyValueTable'
import { RestormVariableInputBox } from '../RestormVariableInputBox'
import { useEnvVariables } from '../../hooks/useEnvVariables'
import { useHandlebarsHelpers } from '../../hooks/useHandlebarsHelpers'
import { useTransportReplaced } from '../../hooks/useTransportReplaced'
import { updateReactiveProperty } from './requestTabViewUtils'

const containerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  padding: 16,
  overflow: 'auto'
}
const sectionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6
}
const labelStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--descriptionForeground)',
  fontWeight: 600
}
const hintStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--descriptionForeground)',
  fontStyle: 'italic'
}
const inputWrapperStyle: CSSProperties = {
  maxWidth: 360
}

export interface AuthenticationConfigurationTabProps {
  request: AuthenticationRequest
  /** Conflict-resolution field-diff (AC#4) for this tab's 3 fields —
   * `computeEntityFieldDiff`'s `fields` map. Red-borders `expiration`/
   * `authErrorCodes` (discrete inputs) and coarse-borders the whole
   * produced-headers table when it differs. Only ever set by
   * `ConflictEntityPanel`; `undefined` in the live (non-conflict) editor. */
  fieldDiff?: { producedHeaders?: boolean, expirationExpression?: boolean, authErrorCodes?: boolean }
}

function parseCodes(raw: string): number[] {
  return raw
    .split(/[,\s]+/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0)
}

function formatCodes(codes: readonly number[]): string {
  return codes.join(', ')
}

export const AuthenticationConfigurationTab: React.FC<AuthenticationConfigurationTabProps> = ({ request, fieldDiff }) => {
  const { t } = useTranslation()
  const handlebarsHelpers = useHandlebarsHelpers()
  // Environment variables for the scalar {{...}} expiration field so its
  // autocomplete offers env vars alongside the helper functions.
  const envVariables = useEnvVariables(request.id)
  const producedHeadersRef = useRef<KeyValueTableHandle | null>(null)

  // Remount the produced-headers table on a quick-config load (or MCP
  // update_request): the ECUI KeyValueTable seeds its rows from props once
  // at mount, so without a key change the restored rows would not appear.
  // expirationExpression + authErrorCodes read `request.*` live, so they
  // re-sync on the re-render this triggers.
  const [transportEpoch, setTransportEpoch] = useState(0)
  useTransportReplaced(request, () => { setTransportEpoch((n) => n + 1) })

  const handleProducedHeadersChange = useCallback((rows: KeyValue[]) => {
    updateReactiveProperty(request, 'producedHeaders', rows)
  }, [request])

  const handleExpirationChange = useCallback((next: string) => {
    // Persist the raw string — the engine treats empty / whitespace
    // as "never auto-expire" downstream.
    updateReactiveProperty(request, 'expirationExpression', next)
  }, [request])

  const handleCodesChange = useCallback((raw: string) => {
    const next = parseCodes(raw)
    updateReactiveProperty(request, 'authErrorCodes', next.length > 0 ? next : [401, 403])
  }, [request])

  return (
    <div style={containerStyle} data-testid="auth-request-configuration">
      <section style={sectionStyle}>
        <span style={labelStyle}>
          {t('authRequestTab.producedHeaders', 'Produced headers')}
        </span>
        <span style={hintStyle}>
          {t(
            'authRequestTab.producedHeadersHint',
            'Each value is a handlebars expression evaluated against the auth response (e.g. Bearer {{access_token}}).'
          )}
        </span>
        <div style={{ display: 'flex' }}>
          <Button
            small
            icon="add"
            options={{
              ariaLabel: t('authRequestTab.addProducedHeader', 'Add produced header'),
              title: t('authRequestTab.addProducedHeader', 'Add produced header')
            }}
            onClick={() => { producedHeadersRef.current?.addRow() }}
            data-testid="auth-request-add-produced-header-button"
          >
            {t('authRequestTab.addProducedHeader', 'Add produced header')}
          </Button>
        </div>
        <div style={{ boxSizing: 'border-box', border: '1px solid transparent', ...fieldDiffStyle(!!fieldDiff?.producedHeaders) }}>
          <RestormKeyValueTable
            key={`produced-headers-${transportEpoch}`}
            ref={producedHeadersRef}
            variables={[]}
            helpers={handlebarsHelpers}
            initialRows={request.producedHeaders}
            onRowsChange={handleProducedHeadersChange}
            data-testid="auth-request-produced-headers"
          />
        </div>
      </section>

      <section style={sectionStyle}>
        <span style={labelStyle}>
          {t('authRequestTab.expiration', 'Expiration (seconds)')}
        </span>
        <span style={hintStyle}>
          {t(
            'authRequestTab.expirationHint',
            'Handlebars expression yielding the seconds after which the cached headers are stale (e.g. {{expires_in}}). Empty ⇒ never auto-expire.'
          )}
        </span>
        <div style={{ ...inputWrapperStyle, boxSizing: 'border-box', border: '1px solid transparent', ...fieldDiffStyle(!!fieldDiff?.expirationExpression) }}>
          <RestormVariableInputBox
            value={request.expirationExpression ?? ''}
            onChange={handleExpirationChange}
            variables={envVariables}
            helpers={handlebarsHelpers}
            placeholder="{{expires_in}}"
            data-testid="auth-request-expiration"
          />
        </div>
      </section>

      <section style={sectionStyle}>
        <span style={labelStyle}>
          {t('authRequestTab.authErrorCodes', 'Auth error codes')}
        </span>
        <span style={hintStyle}>
          {t(
            'authRequestTab.authErrorCodesHint',
            'Comma-separated HTTP status codes. When a downstream request returns one of these, the auth cache is invalidated and the call is retried exactly once. Defaults to 401, 403.'
          )}
        </span>
        <div style={{ ...inputWrapperStyle, boxSizing: 'border-box', border: '1px solid transparent', ...fieldDiffStyle(!!fieldDiff?.authErrorCodes) }}>
          <InputBox
            value={formatCodes(request.authErrorCodes)}
            onChange={handleCodesChange}
            options={{ placeholder: '401, 403' }}
            data-testid="auth-request-error-codes"
          />
        </div>
      </section>
    </div>
  )
}
