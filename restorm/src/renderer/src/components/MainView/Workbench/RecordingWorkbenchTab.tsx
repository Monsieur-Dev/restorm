import React from 'react'
import { useTranslation } from 'react-i18next'
import type { RecordingSession } from '../../../../../shared/types/collections'
import type { BreadcrumbItem } from '../../../../../shared/types/editor'
import { recordingNodeRowId, recordingNodeSpec, type RecordingTabNode } from '../../../../../shared/recording/recordingSections'
import { RestormWorkbenchTab, type RestormWorkbenchTabProps } from './RestormWorkbenchTab'
import './recordingWorkbenchTab.css'

type RecordingWorkbenchTabProps = Omit<
  RestormWorkbenchTabProps,
  'children' | 'titleEditable' | 'showBookmarks' | 'tags' | 'onTagsChange' | 'tagColors' | 'onTagColorChange'
> & {
  session: RecordingSession
  node: RecordingTabNode
}

/**
 * The shell of every recording-session tab: the session's own config tab
 * (the session row) and its node tabs (browser / captures / routes). The
 * trail mirrors the sidebar — `…path / Session [ / Node ]` — and the H1 is
 * editable only on the config tab (renaming the session).
 */
export const RecordingWorkbenchTab: React.FC<RecordingWorkbenchTabProps> = ({ session, node, breadcrumbs, tabId, ...rest }) => {
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
        <p className="recording-tab-placeholder">{t(`recording.placeholder.${node}`)}</p>
      </div>
    </RestormWorkbenchTab>
  )
}
