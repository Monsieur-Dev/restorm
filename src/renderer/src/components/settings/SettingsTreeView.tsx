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
  selectedCategory: string | null
  onSelectCategory: (categoryKey: string) => void
  level: number
  forceExpand?: boolean
}

const CategoryNode: React.FC<CategoryNodeProps> = ({
  category,
  selectedCategory,
  onSelectCategory,
  level,
  forceExpand = false
}) => {
  const [isExpanded, setIsExpanded] = React.useState(forceExpand || level === 0)

  React.useEffect(() => {
    if (forceExpand) {
      setIsExpanded(true)
    }
  }, [forceExpand])

  const hasChildren = category.categories && Object.keys(category.categories).length > 0
  const hasSettings = category.settings && Object.keys(category.settings).length > 0
  const isSelected = selectedCategory === category.key

  const handleClick = (): void => {
    if (hasSettings) {
      onSelectCategory(category.key)
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
        className={`settings-tree-node__item ${isSelected ? 'settings-tree-node__item--selected' : ''}`}
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

