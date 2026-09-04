import { createBdd } from 'playwright-bdd'
import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import type { Page } from '@playwright/test'
import { test, expect, type LaunchedMcpApp, type McpToolReply } from '../../fixtures/design-mcp.fixture'
import { reconstructDesignGui } from '../../../support/designReconstructGui'
import { canonicalizeDesign } from '../../../support/designReconstruct'
import type { ApiDesign } from '../../../../../src/shared/types/apiDesign'

const { Given, When, Then } = createBdd(test)

const GOLDEN_PATH = resolve(__dirname, '../../../fixtures/codegen-realestate/design.golden.json')
const loadGolden = (): ApiDesign => JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as ApiDesign

let launched: LaunchedMcpApp | null = null
let designId = ''
let callTool: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>

function requireApp(): LaunchedMcpApp {
  if (!launched) throw new Error('launch first')
  return launched
}
function requirePage(): Page {
  return requireApp().page
}
function parsed(reply: McpToolReply): Record<string, unknown> {
  const text = (reply as { content?: { text?: string }[] }).content?.[0]?.text ?? ''
  try { return JSON.parse(text) as Record<string, unknown> } catch { return { raw: text } }
}

Given('restorm is launched blank for GUI reconstruction', async ({ launchAppWithMcp, callMcpTool }) => {
  launched = await launchAppWithMcp({ plan: 'pro' })
  callTool = async (name, args) => parsed(await callMcpTool(requireApp().discovery, name, args))
  await requirePage().waitForTimeout(1200)
  const projectPath = join(mkdtempSync(join(tmpdir(), 'design-gui-recon-')), 'design-gui-recon.restorm')
  expect((await callTool('create_project', { filePath: projectPath }))['error']).toBeUndefined()
  await requirePage().waitForTimeout(800)
})

When('I reconstruct the RealEstate design through the GUI', async () => {
  designId = await reconstructDesignGui(requirePage(), loadGolden())
  expect(designId).not.toBe('')
  // Flush the GUI-built design to disk, then settle the async write.
  await callTool('save_project', {})
  await requirePage().waitForTimeout(3000)
})

Then('the GUI-built design matches the golden except ids and templates', async () => {
  const got = await callTool('get_design', { designId })
  expect(got['error']).toBeUndefined()
  const reconstructed = canonicalizeDesign(got as unknown as ApiDesign)
  const golden = canonicalizeDesign(loadGolden())
  expect(reconstructed).toEqual(golden)
})
