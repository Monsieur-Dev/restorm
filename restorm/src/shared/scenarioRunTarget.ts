import type { FolderItem } from './types/collections'
import { isScenario, isFolder, isEnvironmentFolder } from './types/collections'

/** Sibling index formatted for an index path: 1-based, padded to the sibling count's width. */
export function formatIndex(index: number, totalCount: number): string {
  const width = totalCount <= 0 ? 1 : String(totalCount).length
  return String(index + 1).padStart(width, '0')
}

/** A name made filesystem-safe the way the app's own naming does. */
export function sanitizeName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
}

/**
 * The three ways a scenario can be designated to the headless CLI's `--run`,
 * computed by walking the project tree:
 *  - `name`           — the bare leaf name (`Code`)
 *  - `breadcrumbPath` — the full name path (`Auth Service/Pet API/Main/Code`)
 *  - `indexPath`      — the name path with sibling indices
 *                       (`1 - Auth Service/1 - Pet API/1 - Main/N - Code`),
 *                       which disambiguates two same-name scenarios in the
 *                       same container
 *
 * The UI suggests the SHORTEST unambiguous one; the resolver accepts any of the
 * three and errors explicitly when the given target is ambiguous.
 */
export interface ScenarioTarget {
  id: string
  name: string
  breadcrumbPath: string
  indexPath: string
}

/** Walk all collections, producing a {@link ScenarioTarget} per scenario (incl.
 * nested sub-scenarios). */
export function collectScenarioTargets(roots: readonly FolderItem[]): ScenarioTarget[] {
  const out: ScenarioTarget[] = []
  roots.forEach((root, i) => {
    const indexSeg = `${formatIndex(i, roots.length)} - ${sanitizeName(root.name)}`
    walk(root, root.name, indexSeg, out)
  })
  return out
}

function walk(container: FolderItem, breadcrumb: string, indexPath: string, out: ScenarioTarget[]): void {
  const items = childItems(container)
  items.forEach((item, i) => {
    const childBreadcrumb = `${breadcrumb}/${item.name}`
    const childIndexPath = `${indexPath}/${formatIndex(i, items.length)} - ${sanitizeName(item.name)}`
    if (isScenario(item)) {
      out.push({ id: item.id, name: item.name, breadcrumbPath: childBreadcrumb, indexPath: childIndexPath })
      walk(item, childBreadcrumb, childIndexPath, out) // sub-scenarios
    } else if (isFolder(item) || isEnvironmentFolder(item)) {
      walk(item, childBreadcrumb, childIndexPath, out)
    }
  })
}

function childItems(container: FolderItem): FolderItem[] {
  const items = (container as { items?: unknown }).items
  return Array.isArray(items) ? (items as FolderItem[]) : []
}

/**
 * The SHORTEST `--run` value that uniquely designates `scenarioId`:
 *  - the bare name when no other scenario shares it
 *  - else the breadcrumb path when no other scenario shares THAT
 *  - else the index path (two scenarios with the same name in the same folder).
 * Null when the scenario isn't found.
 */
export function suggestRunTarget(roots: readonly FolderItem[], scenarioId: string): string | null {
  const all = collectScenarioTargets(roots)
  const self = all.find((s) => s.id === scenarioId)
  if (self === undefined) return null
  if (all.filter((s) => s.name === self.name).length === 1) return self.name
  if (all.filter((s) => s.breadcrumbPath === self.breadcrumbPath).length === 1) return self.breadcrumbPath
  return self.indexPath
}

/** Resolve a `--run` target (name / breadcrumb / index path) to a scenario id.
 * Ambiguous (≥2 scenarios match) → an explicit error so the CLI crashes loudly
 * rather than silently picking one. */
export function resolveRunTarget(
  roots: readonly FolderItem[],
  target: string
): { id: string } | { error: string } {
  const all = collectScenarioTargets(roots)
  const matches = all.filter((s) => s.name === target || s.breadcrumbPath === target || s.indexPath === target)
  const ids = [...new Set(matches.map((m) => m.id))]
  if (ids.length === 0) {
    const available = all.map((s) => s.breadcrumbPath).sort()
    const list = available.length > 0 ? `\nAvailable scenarios:\n  ${available.join('\n  ')}` : ''
    return { error: `no scenario named '${target}'.${list}` }
  }
  if (ids.length > 1) {
    const list = matches.map((m) => `${m.breadcrumbPath} (${m.id})`).join('\n  ')
    return { error: `ambiguous scenario '${target}' — ${ids.length} scenarios match:\n  ${list}\nUse the full path (with index prefixes if needed), or --by id.` }
  }
  const [id] = ids
  return id === undefined ? { error: `failed to resolve scenario '${target}'` } : { id }
}
