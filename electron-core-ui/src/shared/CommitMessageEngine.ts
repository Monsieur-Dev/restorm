import Handlebars from 'handlebars'

/**
 * The commit-message template pair for one language. Both are Handlebars
 * template STRINGS — this engine only knows how to compile + render them
 * against a context object; it has no notion of "requests" / "scenarios" /
 * any Restorm-specific entity. The host (restorm) owns:
 *
 * - computing the structural diff (what changed, grouped one line per
 *   entity — never per field / per reposition),
 * - translating each change + the aggregate summary into the target
 *   language (a host-owned i18n concern, independent of the app's active
 *   UI language — see `docs/Git/README.md`),
 * - providing the two templates below (restorm-provided, not
 *   user-overridable in v1) and the context they render against.
 *
 * Kept deliberately thin: the "engine" is exactly `Handlebars.compile`, so
 * any Electron app with its own domain model can reuse it for the same
 * "diff → localized summary" shape without electron-core-ui knowing
 * anything about that domain.
 */
export interface CommitMessageTemplates {
  /** Renders the commit TITLE — typically a short aggregate line. */
  title: string
  /** Renders the commit BODY — typically the per-change detail list. */
  body: string
}

/** The rendered result: a plain title/body pair, ready to prefill the Push
 * modal's fields (still editable by the user afterwards). */
export interface RenderedCommitMessage {
  title: string
  body: string
}

/** Compiled once per distinct template string (title/body are usually
 * re-rendered on every language switch, so this avoids re-parsing the same
 * Handlebars source on each keystroke of a live-updating modal). */
const compileCache = new Map<string, HandlebarsTemplateDelegate>()

function compile(template: string): HandlebarsTemplateDelegate {
  let compiled = compileCache.get(template)
  if (!compiled) {
    compiled = Handlebars.compile(template, { noEscape: true })
    compileCache.set(template, compiled)
  }
  return compiled
}

/**
 * Render a commit title + body from the given templates and context.
 * `context` is passed straight through to Handlebars — any shape the
 * host's templates expect (e.g. `{ titleSummary, lines }`).
 */
export function renderCommitMessage(templates: CommitMessageTemplates, context: Record<string, unknown>): RenderedCommitMessage {
  return {
    title: compile(templates.title)(context),
    body: compile(templates.body)(context)
  }
}
