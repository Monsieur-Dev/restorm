import type { TFunction } from 'i18next'
import type { GitEntityChange, GitEntityKind } from './gitCommitDiff'

const DIFF_KEYS: Record<GitEntityKind, Record<'added' | 'modified' | 'moved' | 'deleted' | 'reordered', string>> = {
  request: { added: 'git.diff.addedRequest', modified: 'git.diff.modifiedRequest', moved: 'git.diff.movedRequest', deleted: 'git.diff.deletedRequest', reordered: 'git.diff.reorderedFolder' },
  scenario: { added: 'git.diff.addedScenario', modified: 'git.diff.modifiedScenario', moved: 'git.diff.movedScenario', deleted: 'git.diff.deletedScenario', reordered: 'git.diff.reorderedFolder' },
  folder: { added: 'git.diff.addedFolder', modified: 'git.diff.modifiedFolder', moved: 'git.diff.movedFolder', deleted: 'git.diff.deletedFolder', reordered: 'git.diff.reorderedFolder' },
  environmentFolder: {
    added: 'git.diff.addedEnvironmentFolder',
    modified: 'git.diff.modifiedEnvironmentFolder',
    moved: 'git.diff.movedEnvironmentFolder',
    deleted: 'git.diff.deletedEnvironmentFolder',
    reordered: 'git.diff.reorderedEnvironmentFolder'
  },
  // The document itself has no "moved", "deleted" or "reordered" state —
  // it is the file. Those actions are unreachable and map to the format
  // line so the table stays total rather than carrying holes a future
  // reader would have to reason about.
  document: {
    added: 'git.diff.stampedFileFormatVersion',
    modified: 'git.diff.changedFileFormatVersion',
    moved: 'git.diff.changedFileFormatVersion',
    deleted: 'git.diff.changedFileFormatVersion',
    reordered: 'git.diff.changedFileFormatVersion'
  }
}

const SINGLE_TITLE_KEYS: Record<GitEntityKind, string> = {
  request: 'git.commitTitle.singleRequest',
  scenario: 'git.commitTitle.singleScenario',
  folder: 'git.commitTitle.singleFolder',
  environmentFolder: 'git.commitTitle.singleEnvironmentFolder',
  document: 'git.commitTitle.singleFileFormatVersion'
}

const COUNT_KEYS: Record<GitEntityKind, string> = {
  request: 'git.commitTitle.countRequest',
  scenario: 'git.commitTitle.countScenario',
  folder: 'git.commitTitle.countFolder',
  environmentFolder: 'git.commitTitle.countEnvironmentFolder',
  document: 'git.commitTitle.countFileFormatVersion'
}

// Folders/environment folders read first (structural), then requests,
// then scenarios — matches the diff-line sort order in `gitCommitDiff`.
// `document` leads: a format change explains why everything else in the
// file may read differently, so it belongs at the front of the summary.
const KIND_ORDER: GitEntityKind[] = ['document', 'folder', 'environmentFolder', 'request', 'scenario']

// Extends `Record<string, unknown>` (rather than a plain interface) so it
// slots straight into `renderCommitMessage`'s generic Handlebars context
// param without a cast at the call site.
export interface CommitMessageContext extends Record<string, unknown> {
  titleSummary: string
  lines: string[]
}

/**
 * Build the Handlebars render context (`{ titleSummary, lines }`, see
 * `renderCommitMessage`) from the structural diff, in the TARGET
 * commit-message language. `t` must be a translator FIXED to that
 * language (`i18n.getFixedT(lang)`) — independent of the app's own active
 * UI language, per `docs/Git/README.md`'s host-owned-i18n note.
 *
 * Title format (per spec): a single changed entity gets a natural
 * sentence ("Update to the request «X»"); several get an aggregate count
 * per kind ("Update to 3 requests, 1 scenario") — the aggregate never
 * distinguishes added/modified/deleted, only the per-entity detail lines
 * do. Body = one line per entity, in the same order as the diff.
 */
export function buildCommitMessageContext(changes: GitEntityChange[], t: TFunction): CommitMessageContext {
  const lines = changes.map((change) => t(DIFF_KEYS[change.kind][change.action], { name: change.name }))

  if (changes.length === 0) {
    return { titleSummary: '', lines }
  }

  const [only] = changes
  if (changes.length === 1 && only) {
    return { titleSummary: t(SINGLE_TITLE_KEYS[only.kind], { name: only.name }), lines }
  }

  const counts = new Map<GitEntityKind, number>()
  for (const change of changes) {
    counts.set(change.kind, (counts.get(change.kind) ?? 0) + 1)
  }
  const parts = KIND_ORDER
    .filter((kind) => counts.has(kind))
    .map((kind) => t(COUNT_KEYS[kind], { count: counts.get(kind) }))
  return { titleSummary: t('git.commitTitle.multiple', { parts: parts.join(', ') }), lines }
}
