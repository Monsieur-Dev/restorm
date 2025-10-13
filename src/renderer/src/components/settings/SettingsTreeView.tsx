import React, { useMemo } from 'react'
import { VscChevronRight, VscChevronDown } from 'react-icons/vsc'
import { SettingsSchema, SettingCategory } from '../../types/settings.types'

interface SettingsTreeViewProps {
  schema: SettingsSchema
  selectedCategory: string | null
  onSelectCategory: (categoryKey: string) => void
  searchQuery?: string
}

export const SettingsTreeView: React.FC<SettingsTreeViewProps> = ({
  schema,
  selectedCategory,
  onSelectCategory,
  searchQuery
}) => {
  // If there's a search query, show all categories (will be filtered by content)
  const shouldExpand = useMemo(() => Boolean(searchQuery && searchQuery.trim() !== ''), [searchQuery])

  return (
    <div className="settings-tree-view">
      {Object.values(schema.categories).map((category) => (
        <CategoryNode
          key={category.key}
          category={category}
          categoryPath={[category.key]}
          selectedCategory={selectedCategory}
          onSelectCategory={onSelectCategory}
          level={0}
          forceExpand={shouldExpand}
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
}

const CategoryNode: React.FC<CategoryNodeProps> = ({
  category,
  categoryPath,
  selectedCategory,
  onSelectCategory,
  level,
  forceExpand = false
}) => {
  // Build full category ID (e.g., "workbench-appearance-language")
  const fullCategoryId = categoryPath.join('-')
  
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
    paddingLeft: `${level * 16 + 8}px`
  }

  return (
    <div className="settings-tree-node">
      <div
        className={`settings-tree-node__item ${isThisSelected ? 'settings-tree-node__item--selected' : ''}`}
        style={indentStyle}
        onClick={handleClick}
      >
        {hasChildren && (
          <span className="settings-tree-node__arrow">
            {isExpanded ? <VscChevronDown /> : <VscChevronRight />}
          </span>
        )}
        <span className="settings-tree-node__label">{category.name}</span>
      </div>

      {isExpanded && hasChildren && category.categories && (
        <div className="settings-tree-node__children">
          {Object.values(category.categories).map((subCategory) => (
            <CategoryNode
              key={subCategory.key}
              category={subCategory}
              categoryPath={[...categoryPath, subCategory.key]}
              selectedCategory={selectedCategory}
              onSelectCategory={onSelectCategory}
              level={level + 1}
              forceExpand={forceExpand}
            />
          ))}
        </div>
      )}
    </div>
  )
}

