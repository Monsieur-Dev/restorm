import React from 'react'
import { useTranslation } from 'react-i18next'
import type { RecordingSession } from '../../../../../shared/types/collections'
import type { BreadcrumbItem } from '../../../../../shared/types/editor'
import { recordingNodeRowId, recordingNodeSpec, type RecordingTabNode } from '../../../../../shared/recording/recordingSections'
import { RestormWorkbenchTab, type RestormWorkbenchTabProps } from './RestormWorkbenchTab'
import { RecordingConfigView } from '../../Recording/RecordingConfigView'
import { RecordingBrowserPanel } from '../../Recording/RecordingBrowserPanel'
import './recordingWorkbenchTab.css'

type RecordingWorkbenchTabProps = Omit<
  RestormWorkbenchTabProps,
  'children' | 'titleEditable' | 'showBookmarks' | 'tags' | 'onTagsChange' | 'tagColors' | 'onTagColorChange'
> & {
  session: RecordingSession
  node: RecordingTabNode
  /** Start recording the session — opens its browser tab, which starts the engine. */
  onStartRecording?: ((sessionId: string) => void) | undefined
  /** Stop the live recording — engine + browser tab. */
  onStopRecording?: ((sessionId: string) => void) | undefined
}

/**
 * The shell of every recording-session tab: the session's own config tab
 * (the session row) and its node tabs (browser / captures / routes). The
 * trail mirrors the sidebar — `…path / Session [ / Node ]` — and the H1 is
 * editable only on the config tab (renaming the session).
 */
export const RecordingWorkbenchTab: React.FC<RecordingWorkbenchTabProps> = ({ session, node, breadcrumbs, tabId, onStartRecording, onStopRecording, ...rest }) => {
  const { t } = useTranslation()
  const trail: BreadcrumbItem[] = node === 'config'
    ? breadcrumbs.map((crumb, i) => (i === breadcrumbs.length - 1 ? { ...crumb, icon: null } : crumb))
    : [...breadcrumbs, { id: recordingNodeRowId(session.id, node), label: t(recordingNodeSpec(node).labelKey), icon: null }]

  return (
    <RestormWorkbenchTab
      {...rest}
      {...(tabId !== undefined ? { tabId } : {})}
      breadcrumbs={trail}
      tags={[]}
      titleEditable={node === 'config'}
      showBookmarks={false}
    >
      <div className="recording-tab-body" data-testid={`recording-tab-${node}`} data-session-id={session.id}>
        {node === 'config' && (
          <RecordingConfigView
            session={session}
            onStartRecording={(id) => { onStartRecording?.(id) }}
            onStopRecording={(id) => { onStopRecording?.(id) }}
          />
        )}
        {node === 'browser' && tabId !== undefined && (
          <RecordingBrowserPanel session={session} tabId={tabId} />
        )}
        {(node === 'captures' || node === 'routes') && (
          <p className="recording-tab-placeholder">{t(`recording.placeholder.${node}`)}</p>
        )}
      </div>
    </RestormWorkbenchTab>
  )
}
