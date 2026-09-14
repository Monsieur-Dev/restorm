import type { ReactNode } from 'react'
import { JsonViewer, type Tab } from 'electron-core-ui/renderer'
import type { TFunction } from 'i18next'

/**
 * The response side of a request tab — the Response / Infos / Cookies / Graph
 * tabs — as a pure builder, so the SAME tabs render a live request's
 * response inside `BaseRequestTabView` and a captured call's response in a
 * recording session's captures pane. One source for the tab set, the
 * placeholders and the graph formatting.
 */

/** The Graph tab's text: pretty-printed JSON, or the raw string when it is not JSON. */
export function formatJsonForGraph(jsonData: unknown): string {
    if (jsonData === undefined || jsonData === null) return ''
    if (typeof jsonData === 'string') {
      try {
        const parsed: unknown = JSON.parse(jsonData)
        return JSON.stringify(parsed, null, 2)
      } catch {
        return jsonData
      }
    }
    return JSON.stringify(jsonData, null, 2)
}

export interface ResponseTabsInput {
  t: TFunction
  /** Whether a response exists (or is expected) at all. */
  showResponse: boolean
  isLoading: boolean
  infosContent?: ReactNode | undefined
  responseContent?: ReactNode | undefined
  cookiesContent?: ReactNode | undefined
  /** Output of {@link formatJsonForGraph}. */
  formattedJson: string
  isDarkTheme: boolean
  /** Once a body / graph was seen, its tab stays even while the next response is in flight. */
  hadResponseOnce: boolean
  hadJsonOnce: boolean
  showInfos: boolean
}

export function buildResponseTabs(input: ResponseTabsInput): Tab[] {
  const { t, showResponse, isLoading, infosContent, responseContent, cookiesContent, formattedJson, isDarkTheme, hadResponseOnce, hadJsonOnce, showInfos } = input
    const hasResponse = showResponse || isLoading

    if (!hasResponse) {
      return [{
        id: 'empty',
        label: t('requestTab.responses.tabs.response'),
        useScrollableElement: false,
        content: (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: 'var(--descriptionForeground)'
          }}>
            {t('requestTab.responses.noResponse')}
          </div>
        )
      }]
    }

    const loadingPlaceholder = (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: 'var(--descriptionForeground)'
      }}>
        {t('requestTab.responses.loading')}
      </div>
    )

    // Shown on the body-bearing tabs (Response / Graph) once the request has
    // resolved but produced no body — e.g. a connection error or an empty
    // response. Distinct from `loadingPlaceholder`: the "Sending…" text must
    // never linger past resolution, and the error details live on Infos.
    const noResponseBodyPlaceholder = (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: 'var(--descriptionForeground)'
      }}>
        {t('requestTab.responses.noResponseBody')}
      </div>
    )

    // A resolved-but-empty body shows the no-body notice; the "Sending…"
    // placeholder is reserved for a genuinely in-flight request.
    const emptyBodyPlaceholder = isLoading ? loadingPlaceholder : noResponseBodyPlaceholder

    const tabs: Tab[] = []

    // Show Response tab once it has been seen at least once
    if (responseContent || hadResponseOnce) {
      tabs.push({
        id: 'response',
        label: t('requestTab.responses.tabs.response'),
        useScrollableElement: false,
        content: (
          // Flex column with minHeight: 0 so the CodeEditor (height: 100%)
          // inside `responseContent` can actually shrink below its
          // intrinsic content size when the modal is compressed — a
          // plain `height: 100%` wrapper leaks the flex child's natural
          // minimum, which is what was pushing Monaco below the frame.
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', boxSizing: 'border-box', padding: '8px 0px 0px 8px' }}>
            {responseContent ?? emptyBodyPlaceholder}
          </div>
        )
      })
    }

    if (showInfos) tabs.push({
      id: 'infos',
      label: t('requestTab.responses.tabs.infos'),
      // Scroll via the shared ecu container so a tall tree of
      // response/request headers can be read inside a constrained
      // modal without leaking past the frame.
      useScrollableElement: true,
      content: (
        <div style={{ boxSizing: 'border-box', padding: '8px 0px 0px 8px' }}>
          {infosContent ?? (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: 'var(--descriptionForeground)'
            }}>
              {isLoading ? t('requestTab.responses.loading') : t('requestTab.responses.noResponse')}
            </div>
          )}
        </div>
      )
    })

    // Cookies tab — sent + received cookies for this request/env. Shown only
    // when the caller wires it (the HTTP-ish protocols), right after Infos.
    if (cookiesContent) {
      tabs.push({
        id: 'cookies',
        label: t('requestTab.responses.tabs.cookies'),
        useScrollableElement: true,
        content: (
          <div style={{ boxSizing: 'border-box', padding: '8px 0px 0px 8px' }}>
            {cookiesContent}
          </div>
        )
      })
    }

    // Show Graph tab once it has been seen at least once
    if (formattedJson || hadJsonOnce) {
      tabs.push({
        id: 'graph',
        label: t('requestTab.responses.tabs.graph'),
        useScrollableElement: false,
        content: formattedJson ? (
          <JsonViewer
            json={formattedJson}
            darkTheme={isDarkTheme}
            minimapToggleLabel={t('scenario.minimap.toggle')}
            data-testid="base-request-graph"
          />
        ) : emptyBodyPlaceholder
      })
    }

    return tabs
}
