import { describe, it, expect } from 'vitest'
import {
  UNSCRUBBABLE_INTEGRATIONS,
  withoutUnscrubbableIntegrations
} from './sentryIntegrations'

/**
 * The SDK's real default set, as of the pinned version. Reproduced by name
 * rather than imported because importing the SDK pulls in Electron; the point of
 * the list is that the two banned names sit among plausible neighbours, so a
 * filter that removed too much would be caught.
 */
const SDK_DEFAULT_NAMES = [
  'SentryMinidump',
  'ElectronBreadcrumbs',
  'ElectronNet',
  'ElectronContext',
  'ChildProcess',
  'OnUncaughtException',
  'PreloadInjection',
  'AdditionalContext',
  'Screenshots',
  'GPUContext',
  'RendererEventLoopBlock',
  'MainProcessSession',
  'EventFilters',
  'FunctionToString',
  'LinkedErrors',
  'Console',
  'NodeFetch',
  'OnUnhandledRejection',
  'ContextLines',
  'LocalVariables',
  'NodeContext',
  'NormalizePaths'
]

const asIntegrations = (names: string[]): { name: string }[] => names.map((name) => ({ name }))

describe('crash SDK integrations — nothing unscrubbable may ship', () => {
  it('removes native minidump capture', () => {
    // A minidump is raw process memory and rides as an attachment, so it never
    // passes through `beforeSend` and can never be proven clean.
    const kept = withoutUnscrubbableIntegrations(asIntegrations(SDK_DEFAULT_NAMES))
    expect(kept.map((i) => i.name)).not.toContain('SentryMinidump')
  })

  it('removes screenshot capture', () => {
    // Inert today (it needs `attachScreenshot`), removed anyway: one option away
    // from shipping a picture of the user's URLs, tokens and request bodies.
    const kept = withoutUnscrubbableIntegrations(asIntegrations(SDK_DEFAULT_NAMES))
    expect(kept.map((i) => i.name)).not.toContain('Screenshots')
  })

  it('keeps every other default integration', () => {
    const kept = withoutUnscrubbableIntegrations(asIntegrations(SDK_DEFAULT_NAMES))
    const expected = SDK_DEFAULT_NAMES.filter(
      (name) => name !== 'SentryMinidump' && name !== 'Screenshots'
    )
    expect(kept.map((i) => i.name)).toEqual(expected)
  })

  it('pins the banned names, so an SDK rename fails here instead of silently re-enabling a leak', () => {
    // Matching is by the SDK's own `name`. If an upgrade renames either
    // integration, the filter stops matching and the leak returns unnoticed —
    // unless this assertion is what breaks first.
    expect([...UNSCRUBBABLE_INTEGRATIONS]).toEqual(['SentryMinidump', 'Screenshots'])
  })

  it('leaves a list that contains neither untouched', () => {
    const clean = asIntegrations(['ElectronContext', 'LinkedErrors'])
    expect(withoutUnscrubbableIntegrations(clean)).toEqual(clean)
  })

  it('is total on an empty list', () => {
    expect(withoutUnscrubbableIntegrations([])).toEqual([])
  })
})
