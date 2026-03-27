import React, { useMemo } from 'react'
import { VscChevronRight, VscChevronDown } from 'react-icons/vsc'
import { SettingsSchema, SettingCategory } from '../../types/settings'

interface SettingsTreeViewProps {
  schema: SettingsSchema
  selectedCategory: string | null
  onSelectCategory: (categoryKey: string) => void
  searchQuery?: string
  /** Optional test id applied to the root element. Defaults to `settingstreeview`. */
  'data-testid'?: string
}

function normalizeTestIdSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export const SettingsTreeView: React.FC<SettingsTreeViewProps> = ({
  schema,
  selectedCategory,
  onSelectCategory,
  searchQuery,
  'data-testid': dataTestId
}) => {
  // If there's a search query, show all categories (will be filtered by content)
  const shouldExpand = useMemo(() => Boolean(searchQuery && searchQuery.trim() !== ''), [searchQuery])
  const rootTestId = dataTestId ?? 'settingstreeview'
  const searchLen = (searchQuery ?? '').trim().length

  return (
    <div
      className="settings-toc-tree"
      data-testid={rootTestId}
      data-selected-category={selectedCategory ?? ''}
      data-search-query-length={String(searchLen)}
    >
      {Object.values(schema.categories).map((category) => (
        <CategoryNode
          key={category.key}
          category={category}
          categoryPath={[category.key]}
          selectedCategory={selectedCategory}
          onSelectCategory={onSelectCategory}
          level={0}
          forceExpand={shouldExpand}
          rootTestId={rootTestId}
        />
      ))}
    </div>
  )
}

interface CategoryNodeProps {
  category: SettingCategory
  categoryPath: string[]
  selectedCategory: string | null
  onSelectCategory: (categoryKey: string) => void
  level: number
  forceExpand?: boolean
  rootTestId: string
}

const CategoryNode: React.FC<CategoryNodeProps> = ({
  category,
  categoryPath,
  selectedCategory,
  onSelectCategory,
  level,
  forceExpand = false,
  rootTestId
}) => {
  // Build full category ID (e.g., "workbench-appearance-language")
  const fullCategoryId = categoryPath.join('-')
  const itemTestId = `${rootTestId}-item-${normalizeTestIdSegment(fullCategoryId)}`
  
  // Check if this category or any of its children is selected
  const isThisSelected = selectedCategory === fullCategoryId
  const isChildSelected = selectedCategory?.startsWith(fullCategoryId + '-')
  
  // Auto-expand if a child is selected
  const [isExpanded, setIsExpanded] = React.useState(
    forceExpand || level === 0 || isChildSelected
  )

  React.useEffect(() => {
    if (forceExpand || isChildSelected) {
      setIsExpanded(true)
    }
  }, [forceExpand, isChildSelected])

  const hasChildren = category.categories && Object.keys(category.categories).length > 0
  const hasSettings = category.settings && Object.keys(category.settings).length > 0

  const handleClick = (): void => {
    if (hasSettings) {
      onSelectCategory(fullCategoryId)
    }
    if (hasChildren) {
      setIsExpanded(!isExpanded)
    }
  }

  const indentStyle = {
    paddingLeft: `${level * 16 + 20}px`
  }

  return (
    <>
      <div
        data-testid={itemTestId}
        data-category-id={fullCategoryId}
        data-level={String(level)}
        data-is-selected={isThisSelected ? 'true' : 'false'}
        data-is-expanded={isExpanded ? 'true' : 'false'}
        data-has-children={hasChildren ? 'true' : 'false'}
        data-has-settings={hasSettings ? 'true' : 'false'}
        className={`settings-tree-item ${isThisSelected ? 'active' : ''} ${level > 0 ? 'nested' : ''}`}
        style={indentStyle}
        onClick={handleClick}
      >
        {hasChildren && (
          <span className="settings-tree-icon">
            {isExpanded ? <VscChevronDown /> : <VscChevronRight />}
          </span>
        )}
        <span>{category.name}</span>
      </div>

      {isExpanded && hasChildren && category.categories && (
        <>
          {Object.values(category.categories).map((subCategory) => (
            <CategoryNode
              key={subCategory.key}
              category={subCategory}
              categoryPath={[...categoryPath, subCategory.key]}
              selectedCategory={selectedCategory}
              onSelectCategory={onSelectCategory}
              level={level + 1}
              forceExpand={forceExpand}
              rootTestId={rootTestId}
            />
          ))}
        </>
      )}
    </>
  )
}
