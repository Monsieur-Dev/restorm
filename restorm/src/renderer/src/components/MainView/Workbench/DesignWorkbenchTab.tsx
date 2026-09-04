import React from 'react'
import { useTranslation } from 'react-i18next'
import type { ApiDesign } from '../../../../../shared/types/collections'
import type { BreadcrumbItem } from '../../../../../shared/types/editor'
import { SIDEBAR_DESIGN_SECTIONS, designSectionRowId } from '../../../../../shared/design/designSections'
import { useActiveDesignSection } from '../../../hooks/useActiveDesignSection'
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
  const spec = SIDEBAR_DESIGN_SECTIONS.find((s) => s.key === activeSection)

  // Non-settings: keep the design's badge on its now-ancestor crumb and add a
  // bare (icon-less) section crumb as the H1. Settings: strip the last crumb's
  // icon, exactly as the design tab did before, and keep the design as the H1.
  const trail: BreadcrumbItem[] = spec
    ? [...breadcrumbs, { id: designSectionRowId(design.id, activeSection), label: t(spec.labelKey), icon: null }]
    : breadcrumbs.map((crumb, i) => (i === breadcrumbs.length - 1 ? { ...crumb, icon: null } : crumb))

  return (
    <RestormWorkbenchTab
      {...rest}
      {...(tabId !== undefined ? { tabId } : {})}
      breadcrumbs={trail}
      tags={[]}
      titleEditable={activeSection === 'settings'}
      showBookmarks={false}
    >
      <DesignTabView design={design} tabId={tabId ?? design.id} />
    </RestormWorkbenchTab>
  )
}
