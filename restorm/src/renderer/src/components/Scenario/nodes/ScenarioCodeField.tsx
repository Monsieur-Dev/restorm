import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, CodeEditor, Modal } from 'electron-core-ui/renderer'
import { loader, type OnMount } from '@monaco-editor/react'
import type * as Monaco from 'monaco-editor'

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

function configureTsDefaults(monaco: typeof Monaco): void {
  const ts = (monaco.languages as unknown as { typescript?: { typescriptDefaults: TsLanguageDefaults; javascriptDefaults: TsLanguageDefaults } }).typescript
  if (!ts) return
  for (const defaults of [ts.typescriptDefaults, ts.javascriptDefaults]) {
    const current = defaults.getDiagnosticsOptions()
    const ignore = new Set([...(current.diagnosticCodesToIgnore ?? []), 1108, 1375])
    defaults.setDiagnosticsOptions({ ...current, diagnosticCodesToIgnore: [...ignore] })
    defaults.addExtraLib(CODE_NODE_GLOBALS_DTS, 'restorm-code-node-globals.d.ts')
  }
}

// Configure the TS service as soon as Monaco loads — BEFORE the first code-node
// editor opens — so the very first validation already knows the globals and
// tolerates the top-level `return`. (Belt-and-suspenders with the onMount below.)
// (`@monaco-editor/react` types the monaco namespace loosely, so cast to the
// real `monaco-editor` shape that `configureTsDefaults` consumes.)
void loader.init().then((monaco) => { configureTsDefaults(monaco as typeof Monaco) }).catch(() => undefined)

const configureMonacoForCodeNode: OnMount = (_editor, monaco) => { configureTsDefaults(monaco as typeof Monaco) }

/** Languages the embedded editor knows how to highlight. Kept as a closed union
 * so callers pick a sensible Monaco mode for the content they edit. */
export type ScenarioCodeLanguage = 'json' | 'xml' | 'yaml' | 'csv' | 'handlebars' | 'plaintext' | 'sql' | 'html' | 'typescript' | 'javascript'

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
}

/** A workbench-scoped, full-screen modal hosting the ECUI `CodeEditor` (Monaco).
 * The node box is too cramped for real editing, so any roomy text field
 * (JSON Schema, Handlebars template, document body, …) pops this open. */
export const ScenarioCodeEditorModal: React.FC<ScenarioCodeEditorModalProps> = ({
  isOpen,
  onClose,
  value,
  onChange,
  language = 'plaintext',
  title,
  dataTestId
}) => (
  <Modal
    title={title}
    isOpen={isOpen}
    onClose={onClose}
    size="full"
    scopeToSelector=".restorm-workbench-tab"
    data-testid={dataTestId ? `${dataTestId}-modal` : 'scn-code-modal'}
  >
    <div className="scn-code-modal-body">
      <CodeEditor
        value={value}
        language={language}
        height="100%"
        onChange={(next) => { onChange(next ?? '') }}
        options={{ wordWrap: 'on', automaticLayout: true }}
        {...((language === 'typescript' || language === 'javascript') && { onMount: configureMonacoForCodeNode })}
        {...(dataTestId && { 'data-testid': `${dataTestId}-editor` })}
      />
    </div>
  </Modal>
)

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
  dataTestId
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
      />
    </div>
  )
}

export default ScenarioCodeField
