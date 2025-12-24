import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Handlebars } from '../../utils/handlebarsHelpers'
import { useHandlebarsHelpers } from '../../hooks/useHandlebarsHelpers'
import {
  Button,
  CodeEditor,
  SplitView,
  Pane,
  logger,
  type VariableDefinition
} from 'electron-core-ui/renderer'
import { RestormVariableInputBox } from '../RestormVariableInputBox'
import { RestormKeyValueTable, type KeyValueTableHandle } from '../RestormKeyValueTable'
import type { GraphQLRequest, GraphQLResponse } from '../../types/collections'
import { useEnvironmentContext } from '../../contexts/useEnvironmentContext'
import type { VariableContext } from '../RestormKeyValueTable'
import { executeGraphQLRequest, type GraphQLRequestInput } from '../../services/request/GraphQLRequestService'
import { BaseRequestTabView } from './BaseRequestTabView'
import { Badge } from '../Badge'
import codeSnippetsTemplate from '../../resources/templates/code-snippets-graphql.hbs?raw'

// Compile the Handlebars template
const compiledTemplate = Handlebars.compile(codeSnippetsTemplate)

// Helper to update reactive proxy properties (intentional mutation for reactive objects)
function updateReactiveProperty<T extends object, K extends keyof T>(obj: T, key: K, value: T[K]): void {
  Object.assign(obj, { [key]: value })
}

export interface GraphQLRequestTabViewProps {
  request: GraphQLRequest
}

export const GraphQLRequestTabView: React.FC<GraphQLRequestTabViewProps> = ({ request }) => {
  const { t } = useTranslation()
  const { environments: _environments, selectedEnvId: _selectedEnvId } = useEnvironmentContext()
  void _environments // TODO: will be used when variable resolution is implemented in backend
  void _selectedEnvId
  const handlebarsHelpers = useHandlebarsHelpers()
  
  const [url, setUrlState] = useState(request.url)
  const [query, setQueryState] = useState(request.query)
  const [variables, setVariablesState] = useState(request.variables ?? '{}')
  const [isSending, setIsSending] = useState(false)
  const [response, setResponse] = useState<GraphQLResponse | null>(null)
  
  const headersRef = useRef<KeyValueTableHandle | null>(null)
  const requestIdRef = useRef(request.id)
  
  useEffect(() => {
    if (requestIdRef.current !== request.id) {
      requestIdRef.current = request.id
      const rafId = requestAnimationFrame(() => {
        setUrlState(request.url)
        setQueryState(request.query)
        setVariablesState(request.variables ?? '{}')
        setResponse(null)
      })
      return (): void => { cancelAnimationFrame(rafId) }
    }
    return undefined
  }, [request])

  // Sync state changes to reactive request object
  const setUrl = useCallback((value: string): void => {
    setUrlState(value)
    updateReactiveProperty(request, 'url', value)
  }, [request])
  const setQuery = useCallback((value: string): void => {
    setQueryState(value)
    updateReactiveProperty(request, 'query', value)
  }, [request])
  const setVariables = useCallback((value: string): void => {
    setVariablesState(value)
    updateReactiveProperty(request, 'variables', value)
  }, [request])
  
  // TODO: Variable resolution will be implemented in backend
  const environmentContext: VariableContext = {}
  const envVariables: VariableDefinition[] = []
  
  const handleSend = (): void => {
    if (isSending) return
    setIsSending(true)
    setResponse(null)
    
    const input: GraphQLRequestInput = {
      request,
      url,
      query,
      variables,
      headers: request.headers,
      variableContext: environmentContext
    }
    
    executeGraphQLRequest(input)
      .then((res) => {
        setResponse(res)
        logger.info('GraphQL request completed', { url: res.requestUrl, status: res.statusCode })
      })
      .catch((err: unknown) => {
        logger.error('GraphQL request failed', { error: String(err) })
      })
      .finally(() => {
        setIsSending(false)
      })
  }
  
  // Request content (SplitView with Query, Variables, Headers)
  const requestContent = (
    <SplitView orientation="vertical" style={{ width: '100%', height: '100%' }}>
      <Pane title={t('graphql.tabs.query')} initialSize={0.5} minSize={150}>
        <div style={{ height: '100%', border: '1px solid var(--panel-border)', borderRadius: 3 }}>
          <CodeEditor
            height="100%"
            language="graphql"
            value={query}
            onChange={(v) => { setQuery(v ?? '') }}
            options={{ minimap: { enabled: false }, wordWrap: 'on', automaticLayout: true }}
          />
        </div>
      </Pane>
      <Pane title={t('graphql.tabs.variables')} initialSize={0.25} minSize={100}>
        <div style={{ height: '100%', border: '1px solid var(--panel-border)', borderRadius: 3 }}>
          <CodeEditor
            height="100%"
            language="json"
            value={variables}
            onChange={(v) => { setVariables(v ?? '{}') }}
            options={{ minimap: { enabled: false }, wordWrap: 'on', automaticLayout: true }}
          />
        </div>
      </Pane>
      <Pane
        title={t('graphql.tabs.headers')}
        initialSize={0.25}
        minSize={100}
        collapsed={request.headers.length === 0}
        headerActions={({ collapsed, toggle }: { collapsed: boolean; toggle: () => void }) => (
          <Button
            secondary
            small
            options={{ ariaLabel: t('requestTab.addHeader'), title: t('requestTab.addHeader') }}
            onClick={() => {
              if (collapsed) toggle()
              headersRef.current?.addRow()
            }}
          >
            <i className="codicon codicon-add" />
          </Button>
        )}
      >
        <RestormKeyValueTable
          ref={headersRef}
          variables={envVariables}
          helpers={handlebarsHelpers}
          initialRows={request.headers}
          onRowsChange={(rows): void => { updateReactiveProperty(request, 'headers', rows) }}
        />
      </Pane>
    </SplitView>
  )
  
  // Generate code snippets
  const codeSnippetsContent = useMemo(() => {
    const escapedQuery = query.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
    const headersData = request.headers.filter(h => h.key).map(h => ({ key: h.key, value: h.value }))
    
    return compiledTemplate({
      url,
      query,
      escapedQuery,
      variables: variables || '{}',
      headers: headersData.length > 0 ? headersData : null,
      operationType: request.operationType,
      apolloMethod: request.operationType === 'mutation' ? 'mutate' : 'query'
    })
  }, [url, query, variables, request.headers, request.operationType])
  
  // Infos content (detailed info panel)
  const infosContent = response ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <span style={{ fontWeight: 600, minWidth: 100 }}>Status:</span>
        <span style={{ color: response.statusCode >= 200 && response.statusCode < 300 ? 'var(--testing-iconPassed)' : 'var(--testing-iconFailed)' }}>
          {response.statusCode}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <span style={{ fontWeight: 600, minWidth: 100 }}>Duration:</span>
        <span>{response.timings.durationMs}ms</span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <span style={{ fontWeight: 600, minWidth: 100 }}>URL:</span>
        <span style={{ wordBreak: 'break-all' }}>{response.requestUrl}</span>
      </div>
      {response.errors && response.errors.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
          <span style={{ fontWeight: 600, color: 'var(--testing-iconFailed)' }}>Errors:</span>
          {response.errors.map((err, i) => (
            <div key={i} style={{ padding: 4, background: 'var(--inputValidation-errorBackground)', borderRadius: 3 }}>
              {err.message}
            </div>
          ))}
        </div>
      )}
    </div>
  ) : null
  
  // Response content (raw JSON)
  const responseContent = response && (response.data ?? response.errors) ? (
    <div style={{ height: '100%', border: '1px solid var(--panel-border)', borderRadius: 3 }}>
      <CodeEditor
        height="100%"
        language="json"
        value={JSON.stringify({ data: response.data, errors: response.errors }, null, 2)}
        options={{ readOnly: true, minimap: { enabled: false }, automaticLayout: true }}
      />
    </div>
  ) : null
  
  // URL section
  const urlSection = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Badge type="GQL" />
      <div style={{ flex: 1, minWidth: 0, paddingLeft: 8 }}>
        <RestormVariableInputBox
          value={url}
          onChange={setUrl}
          variables={envVariables}
          helpers={handlebarsHelpers}
          placeholder={t('graphql.urlPlaceholder')}
        />
      </div>
      <Button onClick={handleSend} options={{ title: t('graphql.send'), ariaLabel: t('graphql.send') }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <i className="codicon codicon-send" />
          <span>{t('graphql.send')}</span>
        </span>
      </Button>
    </div>
  )
  
  return (
    <BaseRequestTabView
      urlSection={urlSection}
      requestContent={requestContent}
      codeSnippetsContent={codeSnippetsContent}
      documentation={request.documentation}
      notes={request.notes}
      onNotesChange={(md): void => { updateReactiveProperty(request, 'notes', md) }}
      isLoading={isSending}
      showResponse={response !== null}
      infosContent={infosContent}
      responseContent={responseContent}
      jsonData={response ? { data: response.data, errors: response.errors } : undefined}
    />
  )
}

export default GraphQLRequestTabView
