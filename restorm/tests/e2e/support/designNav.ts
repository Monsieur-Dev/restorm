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

// ── Sidebar entity nodes (models / enums / routes) ─────────────────────
// The per-section left listings moved into the sidebar tree: each model, enum,
// route(-group) is a node under its design's section row, added / renamed /
// deleted through its context menu. These helpers replace the old in-tab
// `design-<section>-add` / `design-<section>-listview` interactions.

/** Click an open context-menu entry by visible label (menu items render as
 * `.action-menu-item` / `[role="menuitem"]`). */
export async function clickDesignMenuItem(p: Page, pattern: RegExp): Promise<void> {
  const item = p.locator('.action-menu-item, [role="menuitem"]').filter({ hasText: pattern }).first()
  await expect(item).toBeVisible({ timeout: 5000 })
  await item.click()
  await p.waitForTimeout(300)
}

/** Expand a design's section row so its entity nodes appear in the sidebar. */
export async function expandDesignSection(p: Page, designId: string, section: string): Promise<void> {
  await openDesignSection(p, designId, section as DesignSectionKey)
  const sectionRow = row(p, designSectionRowId(designId, section as DesignSectionKey))
  const chevron = sectionRow.locator('button:has(.codicon-chevron-right)')
  if (await chevron.count() > 0) await chevron.click()
}

/** The id of the currently open design (read from `design-tab-view-<id>`). */
export async function getOpenDesignId(p: Page): Promise<string> {
  const testid = await p.locator('[data-testid^="design-tab-view-"]').first().getAttribute('data-testid')
  return (testid ?? '').replace('design-tab-view-', '')
}

/** All entity nodes matching `name` under `designId`'s `section` (for count
 * assertions). */
export function designEntityNodes(p: Page, designId: string, section: string, name: string): ReturnType<Page['locator']> {
  return p
    .locator(`${SIDEBAR} .list-view-row[data-item-id^="design-entity:${designId}:${section}:"]`)
    .filter({ has: p.getByText(name, { exact: true }) })
}

/** Locator for a design entity node (model / enum / route / group) by its
 * display name, under `designId`'s `section`. */
export function designEntityNode(p: Page, designId: string, section: string, name: string): ReturnType<Page['locator']> {
  return designEntityNodes(p, designId, section, name).first()
}

/** Add an entity via a section row's context menu; `label` is the menu entry
 * (e.g. /Add a model/, /Add an enum/, /Add a route/, /Add a group/). */
export async function addDesignEntity(p: Page, designId: string, section: string, label: RegExp): Promise<void> {
  await openDesignSection(p, designId, section as DesignSectionKey)
  const sectionRow = row(p, designSectionRowId(designId, section as DesignSectionKey))
  await expect(sectionRow).toBeVisible({ timeout: 5000 })
  await sectionRow.click({ button: 'right' })
  await p.waitForTimeout(200)
  await clickDesignMenuItem(p, label)
}

/** Select an entity by clicking its sidebar node (expanding the section first).
 * For a route nested in a group, expand any group chevrons first via
 * {@link expandAllSidebarChildren}. */
export async function openDesignEntity(p: Page, designId: string, section: string, name: string): Promise<void> {
  await expandDesignSection(p, designId, section)
  let node = designEntityNode(p, designId, section, name)
  // A nested node (a sub-model under its parent, a route under its group) needs
  // its ancestors expanded. Retry the expand-and-find a few times: the sidebar
  // re-renders as the section navigates, and a single expand pass can race it.
  for (let i = 0; i < 4 && await node.count() === 0; i++) {
    await expandAllSidebarChildren(p, designId, section)
    await p.waitForTimeout(250)
    node = designEntityNode(p, designId, section, name)
  }
  await expect(node).toBeVisible({ timeout: 5000 })
  await node.click()
  await p.waitForTimeout(300)
}

/** Rename an entity node via its context menu (Rename → inline sidebar input).
 * The values-only enum pane carries no name field, so the sidebar node is the
 * only surface for a model/enum/route name. */
export async function renameDesignEntityNode(p: Page, designId: string, section: string, currentName: string, newName: string): Promise<void> {
  // Expanding the section clicks its row, which clears the entity selection —
  // fine for finding the node, but we re-select the renamed node at the end so
  // its detail (e.g. an enum's values pane) is back up for the caller.
  await expandDesignSection(p, designId, section)
  const node = designEntityNode(p, designId, section, currentName)
  await expect(node).toBeVisible({ timeout: 5000 })
  await node.click({ button: 'right' })
  await p.waitForTimeout(200)
  await clickDesignMenuItem(p, /Rename|Renommer/)
  const input = p.locator('[data-testid="sidebar-listview-rename-input"], .list-view-rename-input').first()
  await expect(input).toBeVisible({ timeout: 5000 })
  await input.fill(newName)
  await input.press('Enter')
  await expect(p.locator('[data-testid="sidebar-listview-rename-input"]')).toHaveCount(0, { timeout: 5000 })
  await p.waitForTimeout(250)
  const renamed = designEntityNode(p, designId, section, newName)
  if (await renamed.count() > 0) {
    await renamed.click()
    await p.waitForTimeout(250)
  }
}

/** Open a design entity node's context menu and click its Delete entry. The
 * per-card trash was removed — a node is deleted only from its sidebar menu —
 * so this opens the confirmation modal the caller then confirms. */
export async function deleteDesignEntityNode(p: Page, designId: string, section: string, name: string): Promise<void> {
  await expandDesignSection(p, designId, section)
  const node = designEntityNode(p, designId, section, name)
  await expect(node).toBeVisible({ timeout: 5000 })
  await node.click({ button: 'right' })
  await p.waitForTimeout(200)
  await clickDesignMenuItem(p, /Delete|Supprimer/)
}

/** Expand every collapsed entity node under a design section (reveals routes
 * nested inside their groups, sub-models under their parent). Clicks the FIRST
 * collapsed chevron each pass and re-queries — expanding one may reveal more —
 * capped and with a short per-click timeout so a stuck row can't hang the test. */
export async function expandAllSidebarChildren(p: Page, designId: string, section: string): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const chevron = p.locator(
      `${SIDEBAR} .list-view-row[data-item-id^="design-entity:${designId}:${section}:"] button:has(.codicon-chevron-right)`
    ).first()
    if (await chevron.count() === 0) return
    await chevron.click({ timeout: 3000 }).catch(() => undefined)
    await p.waitForTimeout(120)
  }
}
