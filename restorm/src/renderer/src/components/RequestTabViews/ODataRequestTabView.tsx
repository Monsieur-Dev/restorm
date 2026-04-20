/**
 * ODataRequestTabView — Phase 1 scaffolding.
 *
 * Renders the URL, version selector and the v4 subset of system query
 * options ($filter / $select / $top / $skip / $count) that Phase 1
 * commits. The URL preview is computed live from the serializer so
 * the user can see the canonical OData URL as they type.
 *
 * Phase 1 deliberately ships WITHOUT the execution engine: the Send
 * button is disabled with a tooltip pointing at OYO-180 Phase 1b,
 * where `ODataExecutionService` + the ContextService / URLResolver
 * OData branch land. Builders for `$expand` / `$orderby` / `$search`
 * / `$format` / `$apply`, v2/v3 support, actions/functions and
 * `$batch` follow in later phases per the ticket's acceptance list.
 */

import React, { useCallback, useMemo, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  InputBox,
  SelectBox,
  Toggle,
  type ISelectOptionItem,
  type ISelectData
} from 'electron-core-ui/renderer'
import type { ODataRequest, ODataVersion } from '../../../../shared/types/collections'
import { BaseRequestTabView } from './BaseRequestTabView'
import { updateReactiveProperty } from './requestTabViewUtils'
import {
  serializeODataQueryOptions,
  buildODataUrl,
  keyValuesToPairs
} from '../../../../shared/utils/odataQuery'

const urlRowStyle: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center' }
const urlInputWrapperStyle: CSSProperties = { flex: 1, minWidth: 0 }
const sendButtonWrapperStyle: CSSProperties = { flexShrink: 0 }
const formStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: 12,
  height: '100%',
  boxSizing: 'border-box',
  overflow: 'auto'
}
const rowStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 }
const labelStyle: CSSProperties = { fontSize: 12, color: 'var(--descriptionForeground)' }
const numericRowStyle: CSSProperties = { display: 'flex', gap: 16, alignItems: 'flex-start' }
const numericItemStyle: CSSProperties = { flex: 1, minWidth: 120 }
const previewRowStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }
const previewValueStyle: CSSProperties = {
  fontFamily: 'var(--font-family-mono)',
  fontSize: 12,
  padding: '6px 8px',
  background: 'var(--input-background)',
  border: '1px solid var(--input-border)',
  borderRadius: 4,
  wordBreak: 'break-all',
  userSelect: 'text'
}

const ODATA_VERSION_BY_INDEX: ODataVersion[] = ['v4', 'v3', 'v2']

export interface ODataRequestTabViewProps {
  request: ODataRequest
}

export const ODataRequestTabView: React.FC<ODataRequestTabViewProps> = ({ request }) => {
  const { t } = useTranslation()

  const odataVersionOptions = useMemo<ISelectOptionItem[]>(() => [
    { text: 'v4' },
    { text: t('odataRequestTab.version.v3NotYet', 'v3 (execution not yet supported)') },
    { text: t('odataRequestTab.version.v2NotYet', 'v2 (execution not yet supported)') }
  ], [t])

  // `updateReactiveProperty` mutates the proxied `request` object
  // directly — consistent with the pattern used in HTTPRequestTabView.

  const setUrl = useCallback((next: string) => {
    updateReactiveProperty(request, 'url', next)
  }, [request])

  const setVersion = useCallback((next: string) => {
    updateReactiveProperty(request, 'odataVersion', next as ODataVersion)
  }, [request])

  const setFilter = useCallback((next: string) => {
    updateReactiveProperty(request, 'queryOptions', { ...request.queryOptions, filter: next })
  }, [request])

  const setSelect = useCallback((next: string) => {
    const list = next.split(',').map((s) => s.trim()).filter((s) => s !== '')
    updateReactiveProperty(request, 'queryOptions', { ...request.queryOptions, select: list })
  }, [request])

  const setTop = useCallback((next: string) => {
    updateReactiveProperty(request, 'queryOptions', { ...request.queryOptions, top: next })
  }, [request])

  const setSkip = useCallback((next: string) => {
    updateReactiveProperty(request, 'queryOptions', { ...request.queryOptions, skip: next })
  }, [request])

  const setCount = useCallback((next: boolean) => {
    updateReactiveProperty(request, 'queryOptions', { ...request.queryOptions, count: next })
  }, [request])

  const selectJoined = (request.queryOptions.select ?? []).join(', ')

  // Live URL preview composed from the current (unresolved) values.
  // Handlebars templates stay literal in the preview — resolution
  // happens server-side at send time (Phase 1b).
  const urlPreview = useMemo(() => {
    const systemPairs = serializeODataQueryOptions(request.queryOptions, request.odataVersion)
    const extraPairs = keyValuesToPairs(request.params)
    return buildODataUrl(request.url, systemPairs, extraPairs)
  }, [request.url, request.odataVersion, request.queryOptions, request.params])

  const urlSection = (
    <div style={urlRowStyle} data-testid="odata-request-url-section">
      <div style={urlInputWrapperStyle}>
        <InputBox
          value={request.url}
          onChange={setUrl}
          options={{ placeholder: t('odataRequestTab.urlPlaceholder', 'https://service/odata/EntitySet') }}
          data-testid="odata-request-url"
        />
      </div>
      <div style={sendButtonWrapperStyle}>
        <Button
          disabled
          icon="play"
          options={{
            ariaLabel: t('odataRequestTab.sendDisabled', 'Send: OData execution is not yet enabled'),
            title: t('odataRequestTab.sendDisabled', 'Send: OData execution is not yet enabled')
          }}
          data-testid="odata-request-send"
        >
          {t('odataRequestTab.send', 'Send')}
        </Button>
      </div>
    </div>
  )

  const requestContent = (
    <div style={formStyle} data-testid="odata-request-form">
      <div style={rowStyle}>
        <label style={labelStyle} htmlFor="odata-request-version">
          {t('odataRequestTab.version', 'OData version')}
        </label>
        <SelectBox
          id="odata-request-version"
          className="odata-request-version"
          options={odataVersionOptions}
          selected={Math.max(0, ODATA_VERSION_BY_INDEX.indexOf(request.odataVersion))}
          onDidSelect={(data: ISelectData) => {
            const next = ODATA_VERSION_BY_INDEX[data.index]
            if (next) setVersion(next)
          }}
          data-testid="odata-request-version"
        />
      </div>

      <div style={rowStyle}>
        <label style={labelStyle} htmlFor="odata-filter">$filter</label>
        <InputBox
          value={request.queryOptions.filter ?? ''}
          onChange={setFilter}
          options={{ placeholder: t('odataRequestTab.filterPlaceholder', "Name eq 'Alice' and Age gt 21") }}
          data-testid="odata-request-filter"
        />
      </div>

      <div style={rowStyle}>
        <label style={labelStyle} htmlFor="odata-select">$select</label>
        <InputBox
          value={selectJoined}
          onChange={setSelect}
          options={{ placeholder: t('odataRequestTab.selectPlaceholder', 'Id, Name, Email (comma-separated)') }}
          data-testid="odata-request-select"
        />
      </div>

      <div style={numericRowStyle}>
        <div style={{ ...rowStyle, ...numericItemStyle }}>
          <label style={labelStyle} htmlFor="odata-top">$top</label>
          <InputBox
            value={request.queryOptions.top ?? ''}
            onChange={setTop}
            options={{ placeholder: t('odataRequestTab.topPlaceholder', '50') }}
            data-testid="odata-request-top"
          />
        </div>
        <div style={{ ...rowStyle, ...numericItemStyle }}>
          <label style={labelStyle} htmlFor="odata-skip">$skip</label>
          <InputBox
            value={request.queryOptions.skip ?? ''}
            onChange={setSkip}
            options={{ placeholder: t('odataRequestTab.skipPlaceholder', '0') }}
            data-testid="odata-request-skip"
          />
        </div>
        <div style={{ ...rowStyle, ...numericItemStyle }}>
          <label style={labelStyle}>$count</label>
          <Toggle
            isChecked={request.queryOptions.count === true}
            onChange={setCount}
            data-testid="odata-request-count"
          />
        </div>
      </div>

      <div style={previewRowStyle} data-testid="odata-request-url-preview">
        <span style={labelStyle}>{t('odataRequestTab.urlPreview', 'URL preview (pre-resolution)')}</span>
        <div style={previewValueStyle}>{urlPreview}</div>
      </div>
    </div>
  )

  return (
    <BaseRequestTabView
      requestId={request.id}
      urlSection={urlSection}
      requestContent={requestContent}
      codeSnippetsContent={t(
        'odataRequestTab.codeSnippetsPlaceholder',
        '// Code snippet generation will ship alongside OData execution.'
      )}
      documentation={request.documentation}
      notes={request.notes}
      onNotesChange={(notes: string) => { updateReactiveProperty(request, 'notes', notes) }}
      isLoading={false}
      showResponse={false}
    />
  )
}
