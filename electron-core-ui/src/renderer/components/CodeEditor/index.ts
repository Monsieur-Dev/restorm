export { CodeEditor } from './CodeEditor'
export type { CodeEditorProps, CodeEditorRef } from './CodeEditor'
export { bootstrapMonaco } from './monacoBootstrap'
export {
  findHandlebarsSpans,
  maskHandlebarsForJson,
  isJsonValidIgnoringHandlebars,
  filterHandlebarsMarkers
} from './handlebarsTolerance'
export type {
  HandlebarsSpan,
  HandlebarsSpanOptions,
  HandlebarsMaskVariant,
  HandlebarsToleranceOptions,
  MarkerRangeLike
} from './handlebarsTolerance'
export { findHandlebarsHighlightRanges, HANDLEBARS_INLINE_CLASS } from './handlebarsHighlight'
export type { HandlebarsHighlightRange } from './handlebarsHighlight'
