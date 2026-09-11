import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, CodeEditor, MarkdownViewer, Modal, Tabs, type Tab } from 'electron-core-ui/renderer'
import { loader, type OnMount } from '@monaco-editor/react'
import type * as Monaco from 'monaco-editor'
import { npmPackageGlobalName } from '../../../../../shared/codeNodePackages'
import { CODE_LANGUAGE_LABELS, isCodeLanguage, type CodeLanguage } from '../../../../../shared/codeLanguages'
import { CODE_NODE_EXAMPLES } from './codeNodeExamples'

/** Ambient declarations of everything the `code` node injects into the sandbox,
 * so Monaco's TypeScript service stops red-underlining `input`, `_`, `CryptoJS`,
 * … and the implicit top-level `return` (the script is run as a function body). */
const CODE_NODE_GLOBALS_DTS = [
  '/** The wired `value` input passed into this code node. */',
  'declare const input: any;',
  '/** The run variables (set by input / setVariable nodes), keyed by name. */',
  'declare const vars: Record<string, any>;',
  'declare const _: any;        // lodash',
  'declare const lodash: any;',
  'declare const moment: any;',
  'declare const uuid: any;',
  'declare const nanoid: any;',
  'declare const CryptoJS: any;',
  'declare const Ajv: any;',
  'declare const ajvFormats: any;',
  'declare const chai: any;',
  'declare const expect: any;  // chai.expect (Postman-style)',
  'declare const assert: any;  // chai.assert',
  'declare const cheerio: any;',
  'declare const xml2js: any;',
  'declare function require(name: string): any;'
].join('\n')

/** Teach Monaco's TS/JS language service about the `code` node's sandbox: the
 * injected globals (above) + tolerate a top-level `return` (1108) since the body
 * runs inside a function. typescriptDefaults is a singleton, but restorm only
 * edits TS in this node, so configuring it here is safe + idempotent. */
/** Minimal slice of a Monaco TS/JS `LanguageServiceDefaults` we drive. Monaco
 * 0.55 types `languages.typescript` as a deprecated stub, but the runtime API is
 * intact — so reach it through an explicit typed cast rather than `any`. */
interface TsLanguageDefaults {
  getDiagnosticsOptions: () => { diagnosticCodesToIgnore?: number[] }
  setDiagnosticsOptions: (opts: { diagnosticCodesToIgnore?: number[] }) => void
  addExtraLib: (content: string, filePath?: string) => void
}

/** Build `declare const <global>: any;` for every user-pinned npm package, so
 * Monaco doesn't red-underline a global it can't statically know the shape of.
 * Uses the SAME name transform the sandbox injects the global under
 * ({@link npmPackageGlobalName}) so the declared name always matches the real
 * one at runtime. */
function userPackagesDts(packageNames: readonly string[]): string {
  return packageNames.map((name) => `declare const ${npmPackageGlobalName(name)}: any; // npm: ${name}`).join('\n')
}

function configureTsDefaults(monaco: typeof Monaco, packageNames: readonly string[] = []): void {
  const ts = (monaco.languages as unknown as { typescript?: { typescriptDefaults: TsLanguageDefaults; javascriptDefaults: TsLanguageDefaults } }).typescript
  if (!ts) return
  for (const defaults of [ts.typescriptDefaults, ts.javascriptDefaults]) {
    const current = defaults.getDiagnosticsOptions()
    // 1108 = top-level `return`; 1308/1375/1378 = top-level `await` — both are
    // valid here because the script body runs inside an `async function`.
    const ignore = new Set([...(current.diagnosticCodesToIgnore ?? []), 1108, 1308, 1375, 1378])
    defaults.setDiagnosticsOptions({ ...current, diagnosticCodesToIgnore: [...ignore] })
    defaults.addExtraLib(CODE_NODE_GLOBALS_DTS, 'restorm-code-node-globals.d.ts')
    // A SEPARATE extra lib, keyed by a stable path so re-adding it REPLACES the
    // previous content (Monaco's `addExtraLib` behaviour) rather than piling up
    // stale globals from whichever code node was open before this one —
    // typescriptDefaults is a process-wide singleton, but restorm only ever has
    // one code-node editor mounted at a time (the modal is full-screen/exclusive).
    defaults.addExtraLib(userPackagesDts(packageNames), 'restorm-code-node-user-packages.d.ts')
  }
}

// Configure the TS service as soon as Monaco loads — BEFORE the first code-node
// editor opens — so the very first validation already knows the globals and
// tolerates the top-level `return`. (Belt-and-suspenders with the onMount below.)
// (`@monaco-editor/react` types the monaco namespace loosely, so cast to the
// real `monaco-editor` shape that `configureTsDefaults` consumes.)
void loader.init().then((monaco) => { configureTsDefaults(monaco as typeof Monaco) }).catch(() => undefined)

/** Build the editor's `onMount`, capturing which packages ARE pinned on the
 * node currently being edited (`config.packages`) so the user-packages extra
 * lib reflects the right globals for THIS editor session. */
function makeConfigureMonacoForCodeNode(packageNames: readonly string[]): OnMount {
  return (_editor, monaco) => { configureTsDefaults(monaco as typeof Monaco, packageNames) }
}

/** Languages the embedded editor knows how to highlight. Kept as a closed union
 * so callers pick a sensible Monaco mode for the content they edit. */
export type ScenarioCodeLanguage = 'json' | 'xml' | 'yaml' | 'csv' | 'handlebars' | 'plaintext' | 'sql' | 'html' | 'typescript' | 'javascript' | 'python' | 'lua' | 'ruby' | 'r' | 'csharp'

/** How many lines of the value to show in the collapsed preview. */
const PREVIEW_LINES = 4

function previewText(value: string, placeholder: string): { text: string; isPlaceholder: boolean; extra: number } {
  if (value.trim() === '') return { text: placeholder, isPlaceholder: true, extra: 0 }
  const lines = value.split('\n')
  const shown = lines.slice(0, PREVIEW_LINES).join('\n')
  return { text: shown, isPlaceholder: false, extra: Math.max(0, lines.length - PREVIEW_LINES) }
}

export interface ScenarioCodeEditorModalProps {
  isOpen: boolean
  onClose: () => void
  value: string
  onChange: (next: string) => void
  language?: ScenarioCodeLanguage
  title: string
  dataTestId?: string
  /** Names of the packages pinned on THIS code node (`config.packages`), so the
   * TS/JS editor declares their globals instead of red-underlining them. Only
   * meaningful for `language: 'typescript' | 'javascript'`. */
  packageNames?: readonly string[]
  /** When set (and the language is a runnable `code`-node language), the modal
   * splits into two tabs — "Code" (the editor) and "Need help?" (a runnable
   * example for that language). Only the `code` node opts in; the generic
   * text-field consumers (schema / template / document body) stay single-pane. */
  showHelp?: boolean
}

/** Markdown fence identifier per language, so the help example is
 * syntax-highlighted in the MarkdownViewer. */
const CODE_NODE_FENCE_LANG: Record<CodeLanguage, string> = {
  typescript: 'typescript',
  javascript: 'javascript',
  python: 'python',
  lua: 'lua',
  ruby: 'ruby',
  r: 'r',
  csharp: 'csharp'
}

/** The "Need help?" tab body for the `code` node modal: a short intro plus a
 * runnable example in the language the node currently targets, rendered with the
 * ECUI `MarkdownViewer` so the code block is syntax-highlighted AND copyable
 * (its built-in copy button). Kept here (not in ECUI) because the sandbox
 * contract it documents is project-specific. */
const CodeNodeHelp: React.FC<{ language: CodeLanguage; dataTestId?: string }> = ({ language, dataTestId }) => {
  const { t } = useTranslation()
  const intro = t('scenario.code.help.intro', 'The wired value arrives as `input`, the run variables as `vars`, and the curated standard library is available as globals. Return the result (or, in Python / Ruby / R / C#, leave it as the last expression) to send it out of the `result` port.')
  const exampleFor = t('scenario.code.help.exampleFor', 'Example in {{language}}', { language: CODE_LANGUAGE_LABELS[language] })
  const markdown = `${intro}\n\n**${exampleFor}**\n\n\`\`\`${CODE_NODE_FENCE_LANG[language]}\n${CODE_NODE_EXAMPLES[language]}\n\`\`\`\n`
  return (
    <div className="scn-code-help" {...(dataTestId && { 'data-testid': `${dataTestId}-help` })}>
      <MarkdownViewer value={markdown} />
    </div>
  )
}

/** A workbench-scoped, full-screen modal hosting the ECUI `CodeEditor` (Monaco).
 * The node box is too cramped for real editing, so any roomy text field
 * (JSON Schema, Handlebars template, document body, …) pops this open. The
 * `code` node additionally opts into a "Need help?" tab via `showHelp`. */
export const ScenarioCodeEditorModal: React.FC<ScenarioCodeEditorModalProps> = ({
  isOpen,
  onClose,
  value,
  onChange,
  language = 'plaintext',
  title,
  dataTestId,
  packageNames = [],
  showHelp = false
}) => {
  const { t } = useTranslation()
  const helpLanguage = showHelp && isCodeLanguage(language) ? language : null
  const editor = (
    <div className="scn-code-modal-body">
      <CodeEditor
        value={value}
        language={language}
        height="100%"
        onChange={(next) => { onChange(next ?? '') }}
        options={{ wordWrap: 'on', automaticLayout: true }}
        {...((language === 'typescript' || language === 'javascript') && { onMount: makeConfigureMonacoForCodeNode(packageNames) })}
        {...(dataTestId && { 'data-testid': `${dataTestId}-editor` })}
      />
    </div>
  )
  const tabs: Tab[] = helpLanguage
    ? [
        { id: 'code', label: t('scenario.code.tab.code', 'Code'), content: editor, useScrollableElement: false },
        { id: 'help', label: t('scenario.code.tab.help', 'Need help?'), content: <CodeNodeHelp language={helpLanguage} {...(dataTestId && { dataTestId })} /> }
      ]
    : []
  return (
    <Modal
      title={title}
      isOpen={isOpen}
      onClose={onClose}
      size="full"
      scopeToSelector=".restorm-workbench-tab"
      data-testid={dataTestId ? `${dataTestId}-modal` : 'scn-code-modal'}
    >
      {helpLanguage
        ? (
          <div className="scn-code-modal-tabs">
            <Tabs tabs={tabs} mountStrategy="lazy-once" {...(dataTestId && { 'data-testid': `${dataTestId}-tabs` })} />
          </div>
          )
        : editor}
    </Modal>
  )
}

export interface ScenarioCodeEditButtonProps {
  value: string
  onChange: (next: string) => void
  language?: ScenarioCodeLanguage
  title: string
  ariaLabel?: string
  className?: string
  dataTestId?: string
}

/** Just the edit affordance: a small button + its modal, no preview. Mount this
 * beside an inline editor (e.g. the template field) to offer a full-screen
 * "expand" experience on the same value. */
export const ScenarioCodeEditButton: React.FC<ScenarioCodeEditButtonProps> = ({
  value,
  onChange,
  language,
  title,
  ariaLabel,
  className,
  dataTestId
}) => {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  return (
    <>
      <Button
        medium
        secondary
        icon="screen-full"
        className={`scn-code-edit-button${className ? ` ${className}` : ''}`}
        onClick={() => { setIsOpen(true) }}
        options={{ ariaLabel: ariaLabel ?? t('scenario.codeField.edit', 'Open editor') }}
        {...(dataTestId && { 'data-testid': `${dataTestId}-edit` })}
      />
      <ScenarioCodeEditorModal
        isOpen={isOpen}
        onClose={() => { setIsOpen(false) }}
        value={value}
        onChange={onChange}
        {...(language && { language })}
        title={title}
        {...(dataTestId && { dataTestId })}
      />
    </>
  )
}

export interface ScenarioInlineCodeFieldProps {
  /** Current multiline text. */
  value: string
  onChange: (next: string) => void
  language?: ScenarioCodeLanguage
  title: string
  placeholder?: string
  dataTestId?: string
}

/** The inline multiline editor used INSIDE a `TypedValueField`'s ControlGroup
 * for a text/document operand (json / xml / yaml / csv value, writeFile content,
 * …): a read-only multiline preview + a full-screen expand button + the modal.
 * Renders as a flat fragment (preview, button) so the field's type-pick button
 * lines up flush after it — the document gets room to breathe while the type can
 * still be recast. */
export const ScenarioInlineCodeField: React.FC<ScenarioInlineCodeFieldProps> = ({
  value,
  onChange,
  language,
  title,
  placeholder = '',
  dataTestId
}) => {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const { text, isPlaceholder, extra } = previewText(value, placeholder)
  return (
    <>
      <pre
        className={`scn-code-preview${isPlaceholder ? ' is-placeholder' : ''}`}
        {...(dataTestId && { 'data-testid': `${dataTestId}-preview` })}
      >
        {text}
        {extra > 0 && <span className="scn-code-preview-more">{t('scenario.codeField.moreLines', '+{{count}} lines', { count: extra })}</span>}
      </pre>
      <Button
        medium
        secondary
        icon="screen-full"
        className="scn-code-edit-button"
        onClick={() => { setIsOpen(true) }}
        options={{ ariaLabel: t('scenario.codeField.edit', 'Open editor') }}
        {...(dataTestId && { 'data-testid': `${dataTestId}-edit` })}
      />
      <ScenarioCodeEditorModal
        isOpen={isOpen}
        onClose={() => { setIsOpen(false) }}
        value={value}
        onChange={onChange}
        {...(language && { language })}
        title={title}
        {...(dataTestId && { dataTestId })}
      />
    </>
  )
}

export interface ScenarioCodeFieldProps {
  /** Current multiline text. */
  value: string
  /** Commit a new value (called from the modal editor, debounced by CodeEditor). */
  onChange: (next: string) => void
  /** Monaco language for syntax highlighting. */
  language?: ScenarioCodeLanguage
  /** Small caption rendered above the preview row. */
  caption?: string
  /** Title shown in the full-screen modal header. */
  modalTitle?: string
  /** Placeholder shown in the preview when the value is empty. */
  placeholder?: string
  /** Outline the preview red on a validation error. */
  invalid?: boolean
  /** Base test id; the preview, button and editor derive suffixed ids. */
  dataTestId?: string
  /** Names of the packages pinned on THIS code node (`config.packages`) — see
   * {@link ScenarioCodeEditorModalProps.packageNames}. */
  packageNames?: readonly string[]
  /** Add the modal's "Need help?" tab (a per-language example). See
   * {@link ScenarioCodeEditorModalProps.showHelp}. */
  showHelp?: boolean
}

/**
 * A multiline-text field for scenario node boxes: a READ-ONLY preview plus an
 * edit button (mirroring the calendar / colour pickers). The button opens
 * {@link ScenarioCodeEditorModal} so the actual editing happens full-screen with
 * real syntax highlighting, word-wrap and find. Used by the schema node and any
 * node that needs a roomy text editor.
 */
export const ScenarioCodeField: React.FC<ScenarioCodeFieldProps> = ({
  value,
  onChange,
  language = 'plaintext',
  caption,
  modalTitle,
  placeholder = '',
  invalid,
  dataTestId,
  packageNames,
  showHelp
}) => {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const { text, isPlaceholder, extra } = previewText(value, placeholder)
  const title = modalTitle ?? caption ?? t('scenario.codeField.title', 'Edit')

  return (
    <div className="nodrag scn-code-field-wrap" onMouseDown={(e) => { e.stopPropagation() }}>
      {caption !== undefined && <div className="scn-field-caption">{caption}</div>}
      <div className={`scn-code-preview-row${invalid ? ' scn-field-invalid' : ''}`}>
        <pre
          className={`scn-code-preview${isPlaceholder ? ' is-placeholder' : ''}`}
          {...(dataTestId && { 'data-testid': `${dataTestId}-preview` })}
        >
          {text}
          {extra > 0 && <span className="scn-code-preview-more">{t('scenario.codeField.moreLines', '+{{count}} lines', { count: extra })}</span>}
        </pre>
        <Button
          medium
          secondary
          icon="screen-full"
          className="scn-code-edit-button"
          onClick={() => { setIsOpen(true) }}
          options={{ ariaLabel: t('scenario.codeField.edit', 'Open editor') }}
          {...(dataTestId && { 'data-testid': `${dataTestId}-edit` })}
        />
      </div>
      <ScenarioCodeEditorModal
        isOpen={isOpen}
        onClose={() => { setIsOpen(false) }}
        value={value}
        onChange={onChange}
        language={language}
        title={title}
        {...(dataTestId && { dataTestId })}
        {...(packageNames && { packageNames })}
        {...(showHelp && { showHelp })}
      />
    </div>
  )
}
