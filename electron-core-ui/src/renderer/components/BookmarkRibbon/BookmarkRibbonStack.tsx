import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BookmarkRibbon } from './BookmarkRibbon'
import { Tooltip } from '../Tooltip'
import { Button } from '../Button'
import { InputBox } from '../InputBox'

import './bookmarkRibbon.css'

export interface Bookmark {
  label: string
  color?: string
}

export interface BookmarkRibbonStackProps {
  bookmarks: Bookmark[]
  /** When false, the stack renders as a pure display: the leading
   * `[+]` add ribbon is hidden, no add tooltip is ever mounted, and
   * each ribbon is delegated to in readonly mode (no click, no
   * editor tooltip). Defaults to true. */
  editable?: boolean
  onRename?: (index: number, next: string) => void
  onColorChange?: (index: number, hex: string) => void
  onRemove?: (index: number) => void
  onAdd?: (label: string) => void
  className?: string
  'data-testid'?: string
}

/**
 * Row of bookmark ribbons anchored to the top-right of the positioned
 * ancestor. The `[+]` ribbon sits on the LEFT of the stack; existing
 * bookmarks spill to its right in order. The stack itself positions
 * each ribbon absolutely so the hover-grow doesn't reflow siblings.
 */
export const BookmarkRibbonStack: React.FC<BookmarkRibbonStackProps> = ({
  bookmarks,
  editable = true,
  onRename,
  onColorChange,
  onRemove,
  onAdd,
  className,
  'data-testid': dataTestId
}) => {
  const { t } = useTranslation()
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [addDraft, setAddDraft] = useState('')
  const addBtnRef = useRef<HTMLButtonElement | null>(null)
  const addEditorRef = useRef<HTMLDivElement | null>(null)

  // Close the add-tag tooltip on any click outside of the `[+]`
  // button or the tooltip content. Individual ribbon tooltips handle
  // their own click-outside logic in BookmarkRibbon.
  useEffect(() => {
    if (!isAddOpen) return undefined
    const handler = (ev: MouseEvent): void => {
      const target = ev.target
      if (!(target instanceof Node)) return
      if (addBtnRef.current?.contains(target)) return
      if (addEditorRef.current?.contains(target)) return
      setIsAddOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => { document.removeEventListener('mousedown', handler) }
  }, [isAddOpen])

  const handleAddCommit = useCallback(() => {
    const trimmed = addDraft.trim()
    if (trimmed && onAdd) onAdd(trimmed)
    setAddDraft('')
    setIsAddOpen(false)
  }, [addDraft, onAdd])

  const rootClasses = [
    'ecui-bookmark-ribbon-stack',
    className ?? ''
  ].filter(Boolean).join(' ')

  return (
    <div className={rootClasses} {...(dataTestId !== undefined ? { 'data-testid': dataTestId } : {})}>
      {editable ? (
        <>
          <button
            ref={addBtnRef}
            type="button"
            className="ecui-bookmark-ribbon ecui-bookmark-ribbon--add"
            aria-label={t('bookmarkRibbon.addBookmark')}
            aria-expanded={isAddOpen}
            onClick={() => {
              setAddDraft('')
              setIsAddOpen((prev) => !prev)
            }}
            {...(dataTestId ? { 'data-testid': `${dataTestId}-add` } : {})}
          >
            <span className="ecui-bookmark-ribbon-plus" aria-hidden="true">
              <i className="codicon codicon-add" />
            </span>
          </button>
          <Tooltip
            targetRef={addBtnRef as React.RefObject<HTMLElement | null>}
            show={isAddOpen}
            placement="below"
            className="ecui-bookmark-ribbon-tooltip"
            {...(dataTestId ? { 'data-testid': `${dataTestId}-add-tooltip` } : {})}
            content={
              <div
                ref={addEditorRef}
                className="ecui-bookmark-ribbon-editor"
                onMouseDown={(e) => { e.stopPropagation() }}
              >
                <InputBox
                  options={{ placeholder: 'Bookmark name' }}
                  value={addDraft}
                  // `handleAddCommit` reads `addDraft` synchronously on Enter /
                  // confirm-click, so the draft must track every keystroke; a
                  // debounced onChange would leave it stale at commit time.
                  changeDebounceMs={0}
                  onChange={(next) => { setAddDraft(next) }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      handleAddCommit()
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      setIsAddOpen(false)
                    }
                  }}
                  {...(dataTestId ? { 'data-testid': `${dataTestId}-add-input` } : {})}
                />
                <Button
                  secondary
                  onClick={handleAddCommit}
                  options={{ ariaLabel: 'Create bookmark', title: 'Create bookmark' }}
                  {...(dataTestId ? { 'data-testid': `${dataTestId}-add-confirm` } : {})}
                >
                  Add
                </Button>
              </div>
            }
          />
        </>
      ) : null}
      {bookmarks.map((bookmark, index) => {
        const rename = onRename
        const colorChange = onColorChange
        const remove = onRemove
        return (
          <BookmarkRibbon
            key={`${bookmark.label}-${index}`}
            label={bookmark.label}
            editable={editable}
            {...(bookmark.color !== undefined ? { color: bookmark.color } : {})}
            {...(editable && rename ? { onRename: (next) => { rename(index, next) } } : {})}
            {...(editable && colorChange ? { onColorChange: (hex) => { colorChange(index, hex) } } : {})}
            {...(editable && remove ? { onRemove: () => { remove(index) } } : {})}
            {...(dataTestId ? { 'data-testid': `${dataTestId}-ribbon-${index}` } : {})}
          />
        )
      })}
    </div>
  )
}

export default BookmarkRibbonStack
