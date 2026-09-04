import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { designSectionRowId } from '../../../src/shared/design/designSections'
import type { DesignSectionKey } from '../../../src/shared/types/editor'

const SIDEBAR = '[data-testid="sidebar-listview"]'
const row = (p: Page, itemId: string): ReturnType<Page['locator']> =>
  p.locator(`${SIDEBAR} .list-view-row[data-item-id="${itemId}"]`)

/**
 * Navigate the open design tab to one of its sections. The in-tab icon rail was
 * replaced by SIDEBAR-driven navigation (`8ed8ba12`): the design's sections are
 * virtual sidebar rows under the design node, so expand that node (if needed)
 * and click the section's row. Replaces the old `design-rail-<section>` click.
 */
export async function openDesignSection(p: Page, designId: string, section: DesignSectionKey): Promise<void> {
  const sectionRow = row(p, designSectionRowId(designId, section))
  if (await sectionRow.count() === 0) {
    const designRow = row(p, designId)
    await expect(designRow).toBeVisible({ timeout: 5000 })
    const chevron = designRow.locator('button:has(.codicon-chevron-right)')
    if (await chevron.count() > 0) await chevron.click()
  }
  await expect(sectionRow).toBeVisible({ timeout: 5000 })
  await sectionRow.click()
}

/** As {@link openDesignSection}, but for a design whose id isn't known up front:
 * it reads the id from the open `design-tab-view-<id>`. */
export async function openSectionOfOpenDesign(p: Page, section: DesignSectionKey): Promise<void> {
  const testid = await p.locator('[data-testid^="design-tab-view-"]').first().getAttribute('data-testid')
  const designId = (testid ?? '').replace('design-tab-view-', '')
  await openDesignSection(p, designId, section)
}
