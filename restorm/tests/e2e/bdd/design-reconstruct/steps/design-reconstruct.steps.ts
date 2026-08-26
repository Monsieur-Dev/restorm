import { createBdd } from 'playwright-bdd'
import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import type { Page } from '@playwright/test'
import { test, expect, type LaunchedMcpApp, type McpToolReply } from '../../fixtures/design-mcp.fixture'
import { reconstructDesign, canonicalizeDesign } from '../../../support/designReconstruct'
import type { ApiDesign } from '../../../../../src/shared/types/apiDesign'

const { Given, When, Then } = createBdd(test)

const GOLDEN_PATH = resolve(__dirname, '../../../fixtures/codegen-realestate/design.golden.json')
const loadGolden = (): ApiDesign => JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as ApiDesign

let launched: LaunchedMcpApp | null = null
let reconstructedId = ''

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
let callTool: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>

Given('restorm is launched with MCP for design reconstruction', async ({ launchAppWithMcp, callMcpTool }) => {
  launched = await launchAppWithMcp({ plan: 'pro' })
  callTool = async (name, args) => parsed(await callMcpTool(requireApp().discovery, name, args))
  await requirePage().waitForTimeout(1200)
  const projectPath = join(mkdtempSync(join(tmpdir(), 'design-reconstruct-')), 'design-reconstruct.restorm')
  expect((await callTool('create_project', { filePath: projectPath }))['error']).toBeUndefined()
})

When('the agent reconstructs the RealEstate design from the golden', async () => {
  reconstructedId = await reconstructDesign(callTool, loadGolden())
  expect(reconstructedId).not.toBe('')
  // Flush the rebuilt design to disk (explicit save + settle the async write).
  await callTool('save_project', {})
  await requireApp().page.waitForTimeout(3000)
})

Then('the reconstructed design matches the golden except ids and templates', async () => {
  const got = await callTool('get_design', { designId: reconstructedId })
  expect(got['error']).toBeUndefined()
  const reconstructed = canonicalizeDesign(got as unknown as ApiDesign)
  const golden = canonicalizeDesign(loadGolden())
  expect(reconstructed).toEqual(golden)
})
