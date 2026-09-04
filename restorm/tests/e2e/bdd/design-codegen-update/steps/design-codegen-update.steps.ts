import { createBdd } from 'playwright-bdd'
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import type { Page } from '@playwright/test'
import { test, expect, type LaunchedMcpApp, type McpToolReply } from '../../fixtures/design-mcp.fixture'

const { Given, When, Then } = createBdd(test)

const TEMPLATE_SRC = resolve(__dirname, '../../../fixtures/codegen-template-allquestions')

let launched: LaunchedMcpApp | null = null
let designId = ''
let templateDir = ''
let outputDir = ''
const USER_MARK = '<!-- USER-KEPT-THIS -->'
const TEMPLATE_MARK = '<!-- TEMPLATE-ADDED-THIS -->'

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

const readme = (): string => readFileSync(join(outputDir, 'README.md'), 'utf8')

Given('restorm is launched with MCP for codegen update', async ({ launchAppWithMcp, callMcpTool }) => {
  launched = await launchAppWithMcp({ plan: 'pro' })
  callTool = async (name, args) => parsed(await callMcpTool(requireApp().discovery, name, args))
  await requirePage().waitForTimeout(1200)
  const projectPath = join(mkdtempSync(join(tmpdir(), 'codegen-update-')), 'p.restorm')
  expect((await callTool('create_project', { filePath: projectPath }))['error']).toBeUndefined()
})

Given('a design with the all-questions template pointed at a temp output', async () => {
  // A minimal but non-empty design so the template renders models + routes.
  const created = await callTool('create_design', { name: 'MergeTest', basePath: '/api' })
  designId = String(created['id'])
  expect(designId).not.toBe('')
  await callTool('create_design_model', { designId, name: 'Item' })
  await callTool('set_design_property', { designId, model: 'Item', name: 'id', type: 'string', readOnly: true })
  await callTool('set_design_property', { designId, model: 'Item', name: 'label', type: 'string', required: true })
  await callTool('generate_design_crud', { designId, model: 'Item' })

  // Copy the template so the test can edit it between generations without
  // mutating the committed fixture.
  templateDir = mkdtempSync(join(tmpdir(), 'allq-template-'))
  cpSync(TEMPLATE_SRC, templateDir, { recursive: true })
  outputDir = mkdtempSync(join(tmpdir(), 'allq-output-'))
  const set = await callTool('set_design_templates', { designId, templates: [{ localPath: templateDir, outputDir }] })
  expect(set['error']).toBeUndefined()
})

When('code is generated once', async () => {
  const gen = await callTool('generate_design_code', { designId, localPath: templateDir, confirm: true, outputDir })
  expect(gen['error']).toBeUndefined()
  expect(gen['written']).toBe(true)
  expect(readme()).toContain('# my-app')
})

When('the user edits a generated file and the template is changed', () => {
  // 1. User edits the generated README (appends a line at the end).
  writeFileSync(join(outputDir, 'README.md'), readme() + `\n${USER_MARK}\n`)
  // 2. Template changes: insert a line right after the title in the Jinja.
  const jinjaPath = join(templateDir, 'template', 'README.md.jinja')
  const jinja = readFileSync(jinjaPath, 'utf8')
  writeFileSync(jinjaPath, jinja.replace('# {{ project_name }}\n', `# {{ project_name }}\n${TEMPLATE_MARK}\n`))
})

When('code is generated again', async () => {
  const gen = await callTool('generate_design_code', { designId, localPath: templateDir, confirm: true, outputDir })
  expect(gen['error']).toBeUndefined()
  expect(gen['written']).toBe(true)
})

Then('the regenerated file keeps the user edit and gains the template change', () => {
  const text = readme()
  // The template's new line was folded in…
  expect(text).toContain(TEMPLATE_MARK)
  // …and the user's edit survived (Copier-style update, not an overwrite).
  expect(text).toContain(USER_MARK)
  // …with no conflict markers (the edits were disjoint).
  expect(text).not.toContain('<<<<<<<')
})
