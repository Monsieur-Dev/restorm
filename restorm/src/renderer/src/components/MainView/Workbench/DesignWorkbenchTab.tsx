import React from 'react'
import { useTranslation } from 'react-i18next'
import type { ApiDesign } from '../../../../../shared/types/collections'
import type { BreadcrumbItem } from '../../../../../shared/types/editor'
import { SIDEBAR_DESIGN_SECTIONS, designSectionRowId, designEntityRowId } from '../../../../../shared/design/designSections'
import { useActiveDesignSection } from '../../../hooks/useActiveDesignSection'
import { useActiveDesignEntity } from '../../../hooks/useActiveDesignEntity'
import { DesignTabView } from '../../Design/DesignTabView'
import { RestormWorkbenchTab, type RestormWorkbenchTabProps } from './RestormWorkbenchTab'

type DesignWorkbenchTabProps = Omit<
  RestormWorkbenchTabProps,
  'children' | 'titleEditable' | 'showBookmarks' | 'tags' | 'onTagsChange' | 'tagColors' | 'onTagColorChange'
> & {
  design: ApiDesign
}

/**
 * The design's workbench tab. It enriches the breadcrumb with the SECTION the
 * tab is currently showing, so the trail reads `…path / Design / Section` with
 * the section promoted to the H1 title (the "path > heading" layout every
 * other tab uses). Settings is the design node's own page, so it keeps the
 * design name as the (renameable) H1 with no third segment; every other
 * section demotes the design to a clickable ancestor crumb and shows a
 * read-only section H1. The section is read live so switching sections (a
 * sidebar row click, a jump-to) re-titles the tab.
 */
export const DesignWorkbenchTab: React.FC<DesignWorkbenchTabProps> = ({ design, breadcrumbs, tabId, ...rest }) => {
  const { t } = useTranslation()
  const activeSection = useActiveDesignSection(design.id) ?? 'settings'
  const activeEntity = useActiveDesignEntity(design.id)
  const spec = SIDEBAR_DESIGN_SECTIONS.find((s) => s.key === activeSection)

  // Rebuild the full sidebar hierarchy in the trail: `…path / Design / Section
  // [ / Entity ]`. Settings is the design node's own page (design name stays the
  // H1, no section). Every other section adds a clickable section crumb; when an
  // entity is selected it becomes the H1 and the section demotes to an ancestor
  // link — every crumb but the last navigates (handled in `handleBreadcrumbClick`).
  const trail: BreadcrumbItem[] = (() => {
    if (!spec) return breadcrumbs.map((crumb, i) => (i === breadcrumbs.length - 1 ? { ...crumb, icon: null } : crumb))
    const sectionCrumb: BreadcrumbItem = { id: designSectionRowId(design.id, activeSection), label: t(spec.labelKey), icon: null }
    if (activeEntity?.section === activeSection) {
      // Mirror the sidebar hierarchy exactly: the entity's container ancestors
      // sit between the section crumb and the entity — a route's owning group
      // (and its parent groups), or a sub-model's inheritance parents.
      const crumb = (section: typeof activeEntity.section, id: string, name: string): BreadcrumbItem => ({
        id: designEntityRowId(design.id, section, id),
        label: name === '' ? t('design.schema.unnamed', '(unnamed)') : name,
        icon: null
      })
      const ancestors: BreadcrumbItem[] = []
      const seen = new Set<string>()
      if (activeEntity.section === 'models') {
        let parentId = design.models.find((m) => m.id === activeEntity.entityId)?.design?.inheritsFrom
        while (parentId !== undefined && !seen.has(parentId)) {
          seen.add(parentId)
          const p = design.models.find((m) => m.id === parentId)
          if (p === undefined) break
          ancestors.unshift(crumb('models', p.id, p.doc.name))
          parentId = p.design?.inheritsFrom
        }
      } else if (activeEntity.section === 'routes') {
        const asGroup = design.routeGroups.find((g) => g.id === activeEntity.entityId)
        // A route entity includes its OWNING group in the chain; a group entity
        // starts at its own parent (itself is the entity crumb).
        let cur = asGroup !== undefined
          ? (asGroup.parentId !== undefined ? design.routeGroups.find((g) => g.id === asGroup.parentId) : undefined)
          : design.routeGroups.find((g) => g.routes.some((r) => r.id === activeEntity.entityId))
        while (cur !== undefined && !seen.has(cur.id)) {
          seen.add(cur.id)
          ancestors.unshift(crumb('routes', cur.id, cur.doc.name))
          const pid: string | undefined = cur.parentId
          cur = pid === undefined ? undefined : design.routeGroups.find((g) => g.id === pid)
        }
      }
      return [
        ...breadcrumbs,
        sectionCrumb,
        ...ancestors,
        { id: designEntityRowId(design.id, activeEntity.section, activeEntity.entityId), label: activeEntity.label, icon: null }
      ]
    }
    return [...breadcrumbs, sectionCrumb]
  })()

  return (
    <RestormWorkbenchTab
      {...rest}
      {...(tabId !== undefined ? { tabId } : {})}
      breadcrumbs={trail}
      tags={[]}
      titleEditable={activeSection === 'settings' || activeEntity?.section === activeSection}
      showBookmarks={false}
    >
      <DesignTabView design={design} tabId={tabId ?? design.id} />
    </RestormWorkbenchTab>
  )
}
