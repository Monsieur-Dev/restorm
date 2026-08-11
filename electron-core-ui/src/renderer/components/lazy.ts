import { lazy } from 'react'

export const LazyCodeEditor = lazy(() => import('./CodeEditor/CodeEditor').then((m) => ({ default: m.CodeEditor })))
export const LazyMarkdownEditor = lazy(() =>
  import('./MarkdownEditor/MarkdownEditor').then((m) => ({ default: m.MarkdownEditor }))
)
export const LazyMarkdownViewer = lazy(() =>
  import('./MarkdownViewer/MarkdownViewer').then((m) => ({ default: m.MarkdownViewer }))
)
