import { i18n } from 'electron-core-ui/renderer'
import type { RecordingSession } from '../../../shared/types/collections'
import { recordingNodeSpec, type RecordingTabNode } from '../../../shared/recording/recordingSections'

/** The workbench tab title of a recording session's tab: the session name
 * for its config, `Browser: <name>` / `Captures: <name>` / `Routes: <name>`
 * for its nodes (translated). Resolved at call time, never at import. */
export function recordingTabTitle(session: RecordingSession, node: RecordingTabNode): string {
  if (node === 'config') return session.name
  return i18n.t(recordingNodeSpec(node).tabTitleKey, { name: session.name })
}
