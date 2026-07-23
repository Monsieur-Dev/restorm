import type { CommitMessageTemplates } from 'electron-core-ui'

/**
 * The restorm-provided Handlebars templates ECUI's generic
 * `renderCommitMessage` engine renders against (see `docs/Git/README.md`).
 * One structural shape covers every commit-message language: the actual
 * translation work happens earlier, in `buildCommitMessageContext`'s
 * i18next lookups (bound to the TARGET language, not the app's active UI
 * language) — by the time it reaches this template, `titleSummary` and
 * every entry in `lines` are already fully localized strings. The
 * template only slots them into the title/body positions, and that
 * slotting never varies by language. Not user-overridable in v1.
 */
export const RESTORM_COMMIT_MESSAGE_TEMPLATE: CommitMessageTemplates = {
  title: '{{titleSummary}}',
  body: '{{#each lines}}{{this}}\n{{/each}}'
}
