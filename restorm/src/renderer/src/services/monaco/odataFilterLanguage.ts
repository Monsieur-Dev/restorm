/**
 * Monaco custom-language contribution for the OData `$filter`
 * expression input. Registers (once, hot-reload-safe) a tokenizer for
 * highlighting plus metadata-driven completion, hover, and light
 * validation providers. Per-editor metadata is held in a WeakMap keyed
 * by the Monaco text model (the same pattern as ECUI's
 * `VariableInputBox`), so each request tab feeds its own bound entity
 * type to the shared providers.
 *
 * `{{env.var}}` Handlebars spans are tokenised as opaque literals and
 * skipped by validation, so env templating keeps working inside the
 * filter while the OData grammar drives everything else.
 */

import type * as monacoEditor from 'monaco-editor'
import type { ApiDocumentation } from '../../../../shared/types/apiDocumentation'
import {
  classifyCursor,
  tokenizeFilter,
  COMPARISON_OPERATORS,
  LOGICAL_OPERATORS
} from '../../../../shared/utils/odataFilter/odataFilterGrammar'
import {
  resolveEntityType,
  resolvePropertyPath,
  propertiesFor,
  operatorsForType,
  functionsForType,
  valueSuggestionsForProperty,
  isOperatorValidForType,
  unwrapCollectionType
} from '../../../../shared/utils/odataFilter/odataFilterMetadata'

export const ODATA_FILTER_LANGUAGE_ID = 'odata-filter'

/** Metadata a single editor model needs to drive completion. */
export interface ODataFilterModelData {
  apiDocumentation: ApiDocumentation | undefined
  /** The bound entity type's qualified name (`request.entityTypeRef`). */
  entityTypeRef: string | undefined
  /** i18n-resolved short labels for suggestion/marker detail text.
   * Optional — falls back to English when absent. */
  labels?: ODataFilterLabels
}

export interface ODataFilterLabels {
  property: string
  navigation: string
  operator: string
  logical: string
  function: string
  enumValue: string
  unknownProperty: string
  wrongTypeOperator: string
}

const DEFAULT_LABELS: ODataFilterLabels = {
  property: 'property',
  navigation: 'navigation',
  operator: 'operator',
  logical: 'logical',
  function: 'function',
  enumValue: 'enum value',
  unknownProperty: 'Unknown property',
  wrongTypeOperator: 'Operator not applicable to this property type'
}

interface ProviderState {
  languageRegistered: boolean
  completionDisposable: monacoEditor.IDisposable | null
  hoverDisposable: monacoEditor.IDisposable | null
  modelDataMap: WeakMap<monacoEditor.editor.ITextModel, ODataFilterModelData>
}

// Persist provider state across hot reloads — re-registering the
// language / providers on every HMR cycle leaks disposables and
// double-completes.
const globalKey = '__odataFilterProviders__'

function getProviderState(): ProviderState {
  const win = window as unknown as Record<string, ProviderState | undefined>
  win[globalKey] ??= {
    languageRegistered: false,
    completionDisposable: null,
    hoverDisposable: null,
    modelDataMap: new WeakMap()
  }
  return win[globalKey]
}

/** Associate (or refresh) the metadata a given editor model uses. Call
 * on mount and whenever the bound request / apiDocumentation changes —
 * a re-import that swaps `apiDocumentation` propagates with no reload
 * because the providers read this map live. */
export function setODataFilterModelData(
  model: monacoEditor.editor.ITextModel | null | undefined,
  data: ODataFilterModelData
): void {
  if (!model) return
  getProviderState().modelDataMap.set(model, data)
}

function labelsFor(data: ODataFilterModelData | undefined): ODataFilterLabels {
  return data?.labels ?? DEFAULT_LABELS
}

/** Register the odata-filter language + its providers once. Safe to
 * call from every editor mount — subsequent calls are no-ops. */
export function registerODataFilterLanguage(monaco: typeof monacoEditor): void {
  const state = getProviderState()
  if (state.languageRegistered) return
  state.languageRegistered = true

  monaco.languages.register({ id: ODATA_FILTER_LANGUAGE_ID })

  // Monarch tokenizer — purely cosmetic highlighting. `{{…}}` spans are
  // matched first so a template never gets re-coloured as an operator.
  monaco.languages.setMonarchTokensProvider(ODATA_FILTER_LANGUAGE_ID, {
    comparisonOps: [...COMPARISON_OPERATORS],
    logicalOps: [...LOGICAL_OPERATORS, 'not'],
    tokenizer: {
      root: [
        [/\{\{[^}]*\}\}/, 'variable'],
        [/'(?:[^']|'')*'/, 'string'],
        [/\b[0-9]{4}-[0-9]{2}-[0-9]{2}(?:T[0-9:.Z+-]+)?\b/, 'number'],
        [/\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/, 'number'],
        [/-?\b[0-9][0-9.eE+-]*\b/, 'number'],
        [/\b(true|false|null)\b/, 'keyword'],
        [
          /[A-Za-z_][A-Za-z0-9_]*/,
          {
            cases: {
              '@comparisonOps': 'operators',
              '@logicalOps': 'keyword',
              '@default': 'identifier'
            }
          }
        ],
        [/[()]/, 'delimiter.parenthesis'],
        [/\//, 'delimiter']
      ]
    }
  } as monacoEditor.languages.IMonarchLanguage)

  state.completionDisposable = monaco.languages.registerCompletionItemProvider(
    ODATA_FILTER_LANGUAGE_ID,
    {
      triggerCharacters: [' ', '/', '(', ','],
      provideCompletionItems(model, position) {
        const data = getProviderState().modelDataMap.get(model)
        const text = model.getValue()
        const offset = model.getOffsetAt(position)
        const ctx = classifyCursor(text, offset)
        if (ctx.inTemplate) return { suggestions: [] }

        const labels = labelsFor(data)
        const apiDoc = data?.apiDocumentation
        const rootRef = data?.entityTypeRef
        const rootModel = resolveEntityType(apiDoc, rootRef)

        const word = model.getWordUntilPosition(position)
        const range: monacoEditor.IRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn
        }
        const suggestions: monacoEditor.languages.CompletionItem[] = []
        const K = monaco.languages.CompletionItemKind

        if (ctx.kind === 'property') {
          // When mid-navigation-path (Customer/…), resolve the model at
          // the path so far and suggest its properties.
          let model2 = rootModel
          if (ctx.prefix === '' && text.slice(0, offset).trimEnd().endsWith('/')) {
            const navPath = pathBeforeCursor(text, offset)
            const navProp = navPath ? resolvePropertyPath(apiDoc, rootRef, navPath) : undefined
            if (navProp?.targetModelRef) model2 = apiDoc?.models[navProp.targetModelRef]
          }
          for (const p of propertiesFor(model2, apiDoc)) {
            suggestions.push({
              label: p.name,
              kind: p.isNavigation ? K.Reference : K.Field,
              insertText: p.name,
              detail: `${p.isNavigation ? labels.navigation : labels.property}: ${p.type}`,
              sortText: `0_${p.name}`,
              range
            })
          }
        } else if (ctx.kind === 'operator') {
          const prop = ctx.propertyPath
            ? resolvePropertyPath(apiDoc, rootRef, ctx.propertyPath)
            : undefined
          const isEnum = Boolean(prop?.targetModelRef && isEnumModel(apiDoc, prop.targetModelRef))
          const type = prop?.type ?? 'Edm.String'
          for (const op of operatorsForType(type, isEnum)) {
            suggestions.push({
              label: op,
              kind: K.Operator,
              insertText: `${op} `,
              detail: labels.operator,
              sortText: `0_${op}`,
              range
            })
          }
          for (const fn of functionsForType(type)) {
            suggestions.push({
              label: fn,
              kind: K.Function,
              insertText: `${fn}($0)`,
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              detail: labels.function,
              sortText: `1_${fn}`,
              range
            })
          }
        } else if (ctx.kind === 'value') {
          const prop = ctx.propertyPath
            ? resolvePropertyPath(apiDoc, rootRef, ctx.propertyPath)
            : undefined
          for (const v of valueSuggestionsForProperty(prop, apiDoc)) {
            const isSnippet = v.insertText.includes('${')
            const detail = v.detail === 'enum' ? labels.enumValue : v.detail
            suggestions.push({
              label: v.label,
              kind: v.detail === 'enum' ? K.EnumMember : K.Value,
              insertText: v.insertText,
              ...(isSnippet
                ? { insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet }
                : {}),
              ...(detail !== undefined ? { detail } : {}),
              sortText: `0_${v.label}`,
              range
            })
          }
        } else if (ctx.kind === 'logical') {
          for (const lg of LOGICAL_OPERATORS) {
            suggestions.push({
              label: lg,
              kind: K.Keyword,
              insertText: `${lg} `,
              detail: labels.logical,
              sortText: `0_${lg}`,
              range
            })
          }
        }

        // incomplete: re-query as the user types so a metadata refresh
        // (re-import) shows up without a reload.
        return { suggestions, incomplete: true }
      }
    }
  )

  state.hoverDisposable = monaco.languages.registerHoverProvider(ODATA_FILTER_LANGUAGE_ID, {
    provideHover(model, position) {
      const data = getProviderState().modelDataMap.get(model)
      if (!data?.apiDocumentation || !data.entityTypeRef) return { contents: [] }
      const wordInfo = model.getWordAtPosition(position)
      if (!wordInfo) return { contents: [] }

      // Build the navigation path the hovered word terminates (so
      // `Customer/Name` hovers resolve the nested property).
      const text = model.getValue()
      const lineStart = model.getOffsetAt({ lineNumber: position.lineNumber, column: 1 })
      const wordEndOffset = lineStart + wordInfo.endColumn - 1
      const path = pathEndingAt(text, wordEndOffset)
      const prop = resolvePropertyPath(data.apiDocumentation, data.entityTypeRef, path || wordInfo.word)
      if (!prop) return { contents: [] }

      const { inner, collection } = unwrapCollectionType(prop.type)
      const typeLabel = collection ? `Collection(${inner})` : inner
      const lines = [`**${prop.name}**: \`${typeLabel}\``]
      if (prop.format) lines.push(`*format:* ${prop.format}`)
      if (prop.targetModelRef) {
        const target = data.apiDocumentation.models[prop.targetModelRef]
        const members = enumMembers(target)
        if (members.length > 0) lines.push(`*values:* ${members.join(', ')}`)
      }
      return {
        range: new monaco.Range(
          position.lineNumber,
          wordInfo.startColumn,
          position.lineNumber,
          wordInfo.endColumn
        ),
        contents: lines.map((value) => ({ value }))
      }
    }
  })
}

/** Recompute + apply validation markers for a model (unknown property,
 * wrong-type operator). Call on content change. Safe no-op without
 * metadata (graceful degradation, AC #8). */
export function validateODataFilterModel(
  monaco: typeof monacoEditor,
  model: monacoEditor.editor.ITextModel
): void {
  const data = getProviderState().modelDataMap.get(model)
  const markers: monacoEditor.editor.IMarkerData[] = []

  if (data?.apiDocumentation && data.entityTypeRef) {
    const apiDoc = data.apiDocumentation
    const rootRef = data.entityTypeRef
    const labels = labelsFor(data)
    const text = model.getValue()
    const tokens = tokenizeFilter(text)

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i]
      if (tok?.type !== 'identifier') continue
      // Build the full property path that this identifier terminates.
      const path = pathEndingAt(text, tok.end)
      const isPathTail = !isFollowedBySlash(tokens, i)
      if (!isPathTail) continue
      // Skip identifiers that are function arguments inside a call —
      // they're property refs too, but we only validate top-level
      // comparison paths for now (kept simple + low-false-positive).
      const prop = resolvePropertyPath(apiDoc, rootRef, path)
      if (!prop) {
        const startPath = tok.end - path.length
        markers.push(marker(monaco, model, startPath, tok.end, labels.unknownProperty, 'error'))
        continue
      }
      // Wrong-type operator: the next meaningful token after the path.
      const opTok = nextMeaningful(tokens, i)
      if (opTok?.type === 'operator') {
        const isEnum = Boolean(prop.targetModelRef && isEnumModel(apiDoc, prop.targetModelRef))
        if (!isOperatorValidForType(opTok.value, prop.type, isEnum)) {
          markers.push(
            marker(monaco, model, opTok.start, opTok.end, labels.wrongTypeOperator, 'warning')
          )
        }
      }
    }
  }

  monaco.editor.setModelMarkers(model, ODATA_FILTER_LANGUAGE_ID, markers)
}

// --- helpers ---------------------------------------------------------

function marker(
  monaco: typeof monacoEditor,
  model: monacoEditor.editor.ITextModel,
  startOffset: number,
  endOffset: number,
  message: string,
  severity: 'error' | 'warning'
): monacoEditor.editor.IMarkerData {
  const start = model.getPositionAt(startOffset)
  const end = model.getPositionAt(endOffset)
  return {
    message,
    severity:
      severity === 'error'
        ? monaco.MarkerSeverity.Error
        : monaco.MarkerSeverity.Warning,
    startLineNumber: start.lineNumber,
    startColumn: start.column,
    endLineNumber: end.lineNumber,
    endColumn: end.column
  }
}

function isEnumModel(apiDoc: ApiDocumentation | undefined, ref: string): boolean {
  const m = apiDoc?.models[ref]
  if (!m) return false
  // Enum models are emitted by the importer without a `properties`
  // array even though the type marks it required — read defensively.
  const props = (m as { properties?: unknown[] }).properties
  return (props?.length ?? 0) === 0 && enumMembers(m).length > 0
}

function enumMembers(model: { enumValues?: unknown[] } | undefined): string[] {
  if (!model) return []
  const out: string[] = []
  if (Array.isArray(model.enumValues)) {
    for (const v of model.enumValues) if (typeof v === 'string') out.push(v)
  }
  if (out.length === 0) {
    const runtimeEnum = (model as { enum?: unknown }).enum
    if (Array.isArray(runtimeEnum)) {
      for (const v of runtimeEnum) if (typeof v === 'string') out.push(v)
    }
  }
  return out
}

/** Extract the `a/b/c` property path that ends at `endOffset` (walks
 * left over identifier / slash runs). */
function pathEndingAt(text: string, endOffset: number): string {
  // include the trailing identifier already covered by endOffset
  let start = endOffset
  while (start > 0) {
    const ch = text.charAt(start - 1)
    if (/[A-Za-z0-9_/]/.test(ch)) start--
    else break
  }
  return text.slice(start, endOffset)
}

/** The path immediately to the left of the cursor when it sits right
 * after a slash (`Customer/`). */
function pathBeforeCursor(text: string, offset: number): string {
  const upTo = text.slice(0, offset).replace(/\/\s*$/, '')
  let start = upTo.length
  while (start > 0) {
    const ch = upTo.charAt(start - 1)
    if (/[A-Za-z0-9_/]/.test(ch)) start--
    else break
  }
  return upTo.slice(start)
}

function isFollowedBySlash(
  tokens: ReturnType<typeof tokenizeFilter>,
  index: number
): boolean {
  for (let t = index + 1; t < tokens.length; t++) {
    const tok = tokens[t]
    if (!tok) return false
    if (tok.type === 'whitespace') continue
    return tok.type === 'slash'
  }
  return false
}

function nextMeaningful(
  tokens: ReturnType<typeof tokenizeFilter>,
  index: number
): (typeof tokens)[number] | undefined {
  for (let t = index + 1; t < tokens.length; t++) {
    const tok = tokens[t]
    if (!tok) continue
    if (tok.type === 'whitespace' || tok.type === 'slash') continue
    if (tok.type === 'identifier') continue // still part of the path
    return tok
  }
  return undefined
}
