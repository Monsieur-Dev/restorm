import { lazy } from 'react'

export const LazyCodeEditor = lazy(() => import('./CodeEditor/CodeEditor'))
export const LazyMarkdownEditor = lazy(() => import('./MarkdownEditor/MarkdownEditor'))
export const LazyMarkdownViewer = lazy(() => import('./MarkdownViewer/MarkdownViewer'))
