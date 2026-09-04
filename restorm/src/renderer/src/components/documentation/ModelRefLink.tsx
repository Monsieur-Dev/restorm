import React from 'react'
import { Button } from 'electron-core-ui/renderer'
import { useDocumentationNavigation } from './documentationNavigation'

export interface ModelRefLinkProps {
  /** Name of the model the link should jump to. Must match a key
   * in `ApiDocumentation.models`. */
  modelName: string
  /** Whether the target is an object MODEL (jump to the model graph) or a
   * named ENUM (jump to the Enums section). Default `'model'`. */
  kind?: 'model' | 'enum'
  /** Optional render override. Defaults to the model name. Useful
   * when the surrounding text already shows array brackets or
   * other decorations and we just need the bare reference name to
   * carry the click target. */
  children?: React.ReactNode
  /** Optional className applied alongside the base ref-link class. */
  className?: string
}

/**
 * Cross-reference link rendered wherever a property / parameter /
 * response schema points at a documented model. Clicking scrolls
 * the host's Models section into view and pans the React Flow
 * canvas to the matching node. No-op when the host is rendered
 * outside a `DocumentationNavigationContext` provider (e.g. unit
 * tests of the table components in isolation).
 */
export const ModelRefLink: React.FC<ModelRefLinkProps> = ({
  modelName,
  kind = 'model',
  children,
  className
}) => {
  const nav = useDocumentationNavigation()
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>): void => {
    e.preventDefault()
    e.stopPropagation()
    if (kind === 'enum') nav?.scrollToEnum(modelName)
    else nav?.scrollToModel(modelName)
  }
  return (
    <Button
      link
      className={className !== undefined && className.length > 0
        ? `documentation-host-model-ref ${className}`
        : 'documentation-host-model-ref'}
      onClick={handleClick}
      data-testid={`documentation-host-model-ref-${modelName}`}
      options={{ ariaLabel: `Jump to model ${modelName}` }}
    >
      {children ?? modelName}
    </Button>
  )
}
