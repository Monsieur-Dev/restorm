import { materializeSample } from '../../../helpers/testcontainers/services'
import { createBdd } from 'playwright-bdd'
import { readFileSync } from 'fs'
import { join, resolve } from 'path'
import { parse as parseYaml } from 'yaml'
import type { ElectronApplication, Page, Locator } from '@playwright/test'
import { configureNextOpenDialogForE2E } from 'electron-core-ui/testing'
import {
  test,
  expect,
  SECRETS_SOURCES_TEMP_DIR,
  SECRET_PLAINTEXT,
  SECRET_ENV_VAR_NAME
} from '../../fixtures/secrets-sources.fixture'

const SAMPLES_DIR = resolve(__dirname, '../../../samples')
const SECRETS_SAMPLE = join(SAMPLES_DIR, 'secrets-sources-demo.restorm')

const { Given, When, Then } = createBdd(test)

let electronApp: ElectronApplication | null = null
let page: Page | null = null
// The on-disk working copy of the demo document, so a step can read it back and
// assert the persisted form (the secret's NAME is stored, its plaintext never).
let workingCopyPath: string | null = null

function requirePage(): Page {
  if (!page) throw new Error('app must be launched before driving UI steps')
  return page
}

function requireApp(): ElectronApplication {
  if (!electronApp) throw new Error('app must be launched before configuring dialogs')
  return electronApp
}

function sidebarRowByName(currentPage: Page, name: string): Locator {
  return currentPage
    .locator('[data-testid="sidebar-listview"] .list-view-row')
    .filter({ has: currentPage.getByText(name, { exact: true }) })
    .first()
}

/** Deep-walk a parsed document collecting every `{ type: 'secret', … }`
 * descriptor, so the persistence invariant can be asserted structurally. */
function collectSecretDescriptors(doc: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    const obj = node as Record<string, unknown>
    if (obj.type === 'secret') out.push(obj)
    for (const value of Object.values(obj)) walk(value)
  }
  walk(doc)
  return out
}

async function expandRowIfCollapsed(currentPage: Page, name: string): Promise<void> {
  const row = sidebarRowByName(currentPage, name)
  if (await row.count() === 0) return
  const expanded = await row.getAttribute('aria-expanded')
  if (expanded !== 'true') await row.click()
}

Given('I open the secrets-sources demo collection', async ({ launchApp, services }) => {
  const launched = await launchApp()
  electronApp = launched.app
  page = launched.page

  const workingCopy = join(SECRETS_SOURCES_TEMP_DIR, 'secrets-sources-demo.restorm')
  materializeSample(SECRETS_SAMPLE, workingCopy, services)
  workingCopyPath = workingCopy

  await configureNextOpenDialogForE2E(requireApp(), { kind: 'openFile', path: workingCopy })
  await page.locator('[data-testid="titlebar-menubar-item-file"]').click()
  await page.locator('[data-testid="titlebar-menu-item-open"]').first().click()

  await expect(sidebarRowByName(page, 'Secrets Service')).toBeVisible({ timeout: 10000 })
})

Then('the env-folder variable should be marked as a secret', async () => {
  const p = requirePage()

  // Open the env-folder view and switch to the Environments tab so the
  // variables table mounts.
  const folderRow = sidebarRowByName(p, 'Secrets Service')
  await expect(folderRow).toBeVisible({ timeout: 5000 })
  await folderRow.click()
  await p.getByRole('tab', { name: 'Environments' }).click()
  await expect(p.locator('[data-testid="environment-folder-sash-container"]')).toBeVisible({ timeout: 10000 })

  // The `apiKey` variable carries a SecretValue, signalled by the secret
  // type marker (icon="lock", typeTestid "secret"). Under the revised model
  // the env-folder preview INTENTIONALLY resolves and reveals the value to
  // the user on demand, so we no longer assert the plaintext is absent from
  // the DOM here — the only invariant that must hold is that the row is
  // recognised as a secret (and, separately, that the plaintext never lands
  // in the persisted document — see the next step).
  await expect(
    p.locator('[data-testid="environment-folder-variables-table-value-type-secret"]')
  ).toBeVisible({ timeout: 5000 })
})

Then('the persisted document should store the secret env-var name but never the resolved plaintext', () => {
  if (!workingCopyPath) throw new Error('the demo collection must be opened before checking the persisted document')
  // The resolved plaintext lives only in memory at run time — a SecretValue is
  // serialised as `{ type: 'secret', source, params }`, so the env-var NAME (the
  // lookup key, not the secret) appears while the resolved plaintext never does.
  // (Note: the fixture's assert node carries the expected plaintext as a plain
  // `string` literal operand — that authored comparison value is NOT a secret;
  // the invariant here is specifically that NO secret descriptor ever carries a
  // resolved plaintext, asserted via the absence of a `resolved` field.)
  const persisted = readFileSync(workingCopyPath, 'utf8')
  expect(persisted).toContain(SECRET_ENV_VAR_NAME)
  expect(persisted).not.toMatch(/\bresolved\s*:/)

  // Stronger structural check: walk the parsed document and assert every
  // `type: 'secret'` node holds only its `{ source, params }` descriptor and
  // never a serialised resolved value.
  const doc: unknown = parseYaml(persisted)
  const secrets = collectSecretDescriptors(doc)
  expect(secrets.length, 'fixture should reference at least one secret descriptor').toBeGreaterThan(0)
  for (const s of secrets) {
    expect(s).not.toHaveProperty('resolved')
    expect(JSON.stringify(s)).not.toContain(SECRET_PLAINTEXT)
  }
})

When('I run the {string} request', async ({}, requestName: string) => {
  const p = requirePage()
  await expandRowIfCollapsed(p, 'Secrets Service')
  const row = sidebarRowByName(p, requestName)
  await expect(row).toBeVisible({ timeout: 5000 })
  await row.click()

  const sendBtn = p.locator('[data-testid="http-request-send-button"]:visible')
  await expect(sendBtn).toBeVisible({ timeout: 10000 })
  await sendBtn.click()
})

Then('the echo response should reflect the resolved secret in the X-Api-Key header', async () => {
  const p = requirePage()
  // The echo endpoint reflects request headers back as JSON. A correctly
  // hydrated secret header means the resolved plaintext rides on
  // X-Api-Key and shows up in the response body.
  const body = p.locator('[data-testid="http-response-body-editor"]:visible')
  await expect(body).toContainText(SECRET_PLAINTEXT, { timeout: 15000 })
  await expect(body).toContainText('X-Api-Key', { timeout: 5000 })
})

Then('the echo response should reflect the env-folder secret in the X-Env-Api-Key header', async () => {
  const p = requirePage()
  // X-Env-Api-Key is a Handlebars expression (`{{apiKey}}`) resolving the
  // env-folder `apiKey` variable, which is itself a SecretValue. Its
  // presence with the resolved plaintext proves the env-folder secret was
  // hydrated into the environment context before dispatch — not only the
  // request's own KeyValue secret.
  const body = p.locator('[data-testid="http-response-body-editor"]:visible')
  await expect(body).toContainText('X-Env-Api-Key', { timeout: 15000 })
  await expect(body).toContainText(SECRET_PLAINTEXT, { timeout: 5000 })
})

Then('the request header should be marked as a secret and reference the env-var name', async () => {
  const p = requirePage()
  // The X-Api-Key header row carries a SecretValue, signalled by the secret
  // type marker on the value cell. Under the revised model the cell shows a
  // collapsed `$<name>=<resolved>` preview (the user's own credential, revealed
  // on demand) rather than masking the value — so the only invariants asserted
  // here are that the row is recognised as a secret and that the env-var NAME
  // (the lookup key, not a secret) is referenced. The persisted-document check
  // (a separate step) owns the "plaintext never lands on disk" invariant.
  await expect(
    p.locator('[data-testid="http-request-headers-table-value-type-secret"]').first()
  ).toBeVisible({ timeout: 5000 })

  // The collapsed secret preview is a disabled InputBox showing `$<name>=<value>`.
  // Its env-var NAME (the lookup key) lives in an input's `.value` property, not
  // textContent — scan the headers table's inputs in the DOM so the assertion is
  // independent of the InputBox wrapper's layout/visibility quirks.
  const headersTable = p.locator('[data-testid="http-request-headers-table"]').first()
  await expect(headersTable).toBeAttached({ timeout: 5000 })
  await expect(async () => {
    const values = await headersTable.evaluate((el) =>
      Array.from(el.querySelectorAll('input')).map((i) => i.value)
    )
    expect(values.some((v) => v.includes(`$${SECRET_ENV_VAR_NAME}=`))).toBe(true)
  }).toPass({ timeout: 5000 })
})
