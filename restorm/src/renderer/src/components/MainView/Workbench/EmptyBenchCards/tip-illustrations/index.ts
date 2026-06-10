import type React from 'react'
import maximizeTabSvg from './maximizeTab.svg?raw'
import mcpControlSvg from './mcpControl.svg?raw'
import envSwitchSvg from './envSwitch.svg?raw'
import authRequestsSvg from './authRequests.svg?raw'
import supplyChainSvg from './supplyChain.svg?raw'
import codeSnippetsSvg from './codeSnippets.svg?raw'
import workbenchLayoutSvg from './workbenchLayout.svg?raw'
import persistStateSvg from './persistState.svg?raw'
import consoleSvg from './console.svg?raw'
import miniBrowserSvg from './miniBrowser.svg?raw'
import apiDocsSvg from './apiDocs.svg?raw'
import secretsSvg from './secrets.svg?raw'
import themesSvg from './themes.svg?raw'
import searchSvg from './search.svg?raw'
import multiEnvSvg from './multiEnv.svg?raw'
import protocolsSvg from './protocols.svg?raw'
import responseTreeSvg from './responseTree.svg?raw'
import responseHistorySvg from './responseHistory.svg?raw'
import multiLanguageSvg from './multiLanguage.svg?raw'
// Scenario tips
import chainRequestsSvg from './chainRequests.svg?raw'
import fromPostmanSvg from './fromPostman.svg?raw'
import codeLanguagesSvg from './codeLanguages.svg?raw'
import stepByStepSvg from './stepByStep.svg?raw'
import interactiveScenariosSvg from './interactiveScenarios.svg?raw'
import cicdSvg from './cicd.svg?raw'
import scenarioAiSvg from './scenarioAi.svg?raw'
import nestedScenariosSvg from './nestedScenarios.svg?raw'
import scenarioHistorySvg from './scenarioHistory.svg?raw'
import codeSandboxSvg from './codeSandbox.svg?raw'
import customValueListsSvg from './customValueLists.svg?raw'
import { FavoritesIllustration } from './FavoritesIllustration'

/**
 * Two flavours of tip illustration:
 *
 *   - `svg`        — raw SVG markup, inlined via dangerouslySetInnerHTML
 *                    so the embedded `<style>` block can read theme CSS
 *                    variables and `currentColor` from the parent.
 *   - `component`  — a React component, used when the illustration
 *                    needs a third-party renderer (Lottie, canvas, …).
 *
 * Add a new illustration by dropping the asset next to this file
 * and registering it below.
 */
export type TipIllustration =
  | { kind: 'svg'; markup: string }
  | { kind: 'component'; Component: React.FC }

export const TIP_ILLUSTRATIONS: Record<string, TipIllustration | undefined> = {
  maximizeTab:     { kind: 'svg', markup: maximizeTabSvg },
  mcpControl:      { kind: 'svg', markup: mcpControlSvg },
  envSwitch:       { kind: 'svg', markup: envSwitchSvg },
  authRequests:    { kind: 'svg', markup: authRequestsSvg },
  supplyChain:     { kind: 'svg', markup: supplyChainSvg },
  codeSnippets:    { kind: 'svg', markup: codeSnippetsSvg },
  workbenchLayout: { kind: 'svg', markup: workbenchLayoutSvg },
  persistState:    { kind: 'svg', markup: persistStateSvg },
  favorites:       { kind: 'component', Component: FavoritesIllustration },
  console:         { kind: 'svg', markup: consoleSvg },
  miniBrowser:     { kind: 'svg', markup: miniBrowserSvg },
  apiDocs:         { kind: 'svg', markup: apiDocsSvg },
  secrets:         { kind: 'svg', markup: secretsSvg },
  themes:          { kind: 'svg', markup: themesSvg },
  search:          { kind: 'svg', markup: searchSvg },
  multiEnv:        { kind: 'svg', markup: multiEnvSvg },
  protocols:       { kind: 'svg', markup: protocolsSvg },
  responseTree:    { kind: 'svg', markup: responseTreeSvg },
  responseHistory: { kind: 'svg', markup: responseHistorySvg },
  multiLanguage:   { kind: 'svg', markup: multiLanguageSvg },
  chainRequests:        { kind: 'svg', markup: chainRequestsSvg },
  fromPostman:          { kind: 'svg', markup: fromPostmanSvg },
  codeLanguages:        { kind: 'svg', markup: codeLanguagesSvg },
  stepByStep:           { kind: 'svg', markup: stepByStepSvg },
  interactiveScenarios: { kind: 'svg', markup: interactiveScenariosSvg },
  cicd:                 { kind: 'svg', markup: cicdSvg },
  scenarioAi:           { kind: 'svg', markup: scenarioAiSvg },
  nestedScenarios:      { kind: 'svg', markup: nestedScenariosSvg },
  scenarioHistory:      { kind: 'svg', markup: scenarioHistorySvg },
  codeSandbox:          { kind: 'svg', markup: codeSandboxSvg },
  customValueLists:     { kind: 'svg', markup: customValueListsSvg }
}
