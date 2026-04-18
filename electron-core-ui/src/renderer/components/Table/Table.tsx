import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ForwardedRef,
  type ReactElement,
  type ReactNode
} from 'react'
import { useColumnWidths, type WidthColumnDef } from './useColumnWidths'
import './table.css'

/**
 * Definition of a single column.
 *
 * A column is either **fixed** (`width` set — e.g. a handle or a delete
 * button) or **resizable** (`resizable: true`). Mixing both in the same
 * table is the typical case: handles/toggles/delete stay pinned while
 * the content columns stretch.
 */
export interface TableColumn<TRow> {
  /** Stable logical key — used for persistence and React keys. */
  id: string
  /** Header cell content. */
  header: ReactNode
  /** Renders the cell for a given row. */
  renderCell: (row: TRow) => ReactNode
  /**
   * Fixed column width in px. When set, the column is not resizable and
   * is excluded from width persistence.
   */
  width?: number | undefined
  /**
   * When true, the column sizes to its content: the widest cell in the
   * column determines the column width. Not resizable. Useful for
   * icon-only or checkbox columns where the visual size is inherent to
   * the cell and you don't want to hard-code a px value.
   */
  autoWidth?: boolean | undefined
  /**
   * When true, the column gets a resize handle on its right edge. Ignored
   * when `width` or `autoWidth` is set.
   */
  resizable?: boolean | undefined
  /** Initial width (px) when no persisted value is present. */
  defaultWidth?: number | undefined
  /** Minimum width (px) during resize. Defaults to 40. */
  minWidth?: number | undefined
  /** Maximum width (px) during resize. Unbounded by default. */
  maxWidth?: number | undefined
}

/**
 * Props for the generic Table component.
 */
export interface TableProps<TRow> {
  /**
   * Optional persistence key. When set, per-column widths are saved to
   * `localStorage` under `ecu:table:<id>:column-widths`. When omitted,
   * widths live in memory for the component lifetime only.
   */
  id?: string | undefined
  /** Column definitions — order is rendering order. */
  columns: TableColumn<TRow>[]
  /** Rows to render. The table is fully controlled. */
  rows: TRow[]
  /** Stable identity for each row. Used for React keys and drag tracking. */
  getRowId: (row: TRow) => string
  /**
   * When true, the table auto-injects a drag-handle column at position 0
   * and wires up HTML5 drag & drop for row reordering.
   */
  reorderable?: boolean | undefined
  /**
   * Fires when the user drops a dragged row at a new position, with the
   * new ordered list of row ids.
   */
  onRowsReorder?: ((orderedIds: string[]) => void) | undefined
  /** Top-level test id — child elements derive their test ids from it. */
  'data-testid'?: string | undefined
}

/**
 * Imperative handle exposed via ref.
 */
export interface TableHandle {
  /**
   * Focus the first focusable element (input, button, [tabindex >= 0])
   * inside the row with the given id. No-op if not found.
   */
  focusRow: (id: string) => void
  /** Clear persisted widths (if any) and revert columns to defaults. */
  resetColumnWidths: () => void
}

const DRAG_COLUMN_ID = '__ecu_drag__'
const DRAG_COLUMN_WIDTH = 18

function TableInner<TRow>(
  props: TableProps<TRow>,
  ref: ForwardedRef<TableHandle>
): ReactElement {
  const {
    id,
    columns,
    rows,
    getRowId,
    reorderable,
    onRowsReorder,
    'data-testid': dataTestId
  } = props

  // Auto-inject the drag-handle column when reorderable.
  const effectiveColumns = useMemo<TableColumn<TRow>[]>(() => {
    if (!reorderable) return columns
    const dragCol: TableColumn<TRow> = {
      id: DRAG_COLUMN_ID,
      header: '',
      width: DRAG_COLUMN_WIDTH,
      renderCell: () => null // drag handle rendered separately inside the cell
    }
    return [dragCol, ...columns]
  }, [columns, reorderable])

  const widthDefs = useMemo<WidthColumnDef[]>(
    () => effectiveColumns.map((c) => ({
      id: c.id,
      width: c.width,
      resizable: c.resizable && !c.autoWidth,
      defaultWidth: c.defaultWidth,
      minWidth: c.minWidth,
      maxWidth: c.maxWidth
    })),
    [effectiveColumns]
  )

  const { widths, setWidth, resetWidths } = useColumnWidths(id, widthDefs)

  // ── Resize drag ──
  const resizeRef = useRef<{ columnId: string; startX: number; startWidth: number; thEl: HTMLElement | null } | null>(null)

  const endResize = useCallback(() => {
    const state = resizeRef.current
    if (!state) return
    state.thEl?.classList.remove('ecu-table-th--resizing')
    resizeRef.current = null
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent): void => {
      const state = resizeRef.current
      if (!state) return
      const delta = e.clientX - state.startX
      const next = state.startWidth + delta
      setWidth(state.columnId, next)
    }
    const handleMouseUp = (): void => {
      endResize()
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [setWidth, endResize])

  const startResize = useCallback((e: React.MouseEvent<HTMLSpanElement>, columnId: string) => {
    e.preventDefault()
    e.stopPropagation()
    const handle = e.currentTarget
    const th = handle.closest('th')
    const currentWidth = th ? th.getBoundingClientRect().width : widths[columnId] ?? 0
    resizeRef.current = {
      columnId,
      startX: e.clientX,
      startWidth: currentWidth,
      thEl: th
    }
    th?.classList.add('ecu-table-th--resizing')
  }, [widths])

  // ── Drag & drop for row reordering ──
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const dragGhostRef = useRef<HTMLDivElement | null>(null)

  const cleanupGhost = useCallback(() => {
    dragGhostRef.current?.parentNode?.removeChild(dragGhostRef.current)
    dragGhostRef.current = null
  }, [])

  const handleDragStart = useCallback((event: React.DragEvent<HTMLElement>, index: number) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
    cleanupGhost()

    const row = event.currentTarget.closest('tr')
    if (!row) return
    const rect = row.getBoundingClientRect()
    const table = document.createElement('table')
    const tbody = document.createElement('tbody')
    const ghostRow = row.cloneNode(true) as HTMLTableRowElement
    table.appendChild(tbody)
    tbody.appendChild(ghostRow)

    const container = document.createElement('div')
    container.className = 'ecu-table-ghost'
    container.style.position = 'fixed'
    container.style.top = '-10000px'
    container.style.left = '-10000px'
    container.style.pointerEvents = 'none'
    container.style.borderRadius = '2px'
    container.style.width = `${rect.width}px`
    container.appendChild(table)
    // Append to the closest `.workbench` ancestor so CSS variables and
    // font inherit from the app theme. Fall back to body if absent
    // (e.g. tests or embedded usage).
    const themeRoot = row.closest<HTMLElement>('.workbench') ?? document.body
    themeRoot.appendChild(container)
    dragGhostRef.current = container

    const offsetX = event.clientX - rect.left
    const offsetY = event.clientY - rect.top
    event.dataTransfer.setDragImage(container, offsetX, offsetY)

    // Hide the source row after `dragstart` completes. Setting state
    // synchronously here would re-render the `<tr>` mid-dragstart and
    // some browsers cancel the drag when the originating node is
    // mutated inside the event handler.
    setTimeout(() => { setDraggingIndex(index) }, 0)
  }, [cleanupGhost])

  const handleDrop = useCallback((event: React.DragEvent<HTMLTableRowElement>) => {
    event.preventDefault()
    const sourceIndexText = event.dataTransfer.getData('text/plain')
    const sourceIndex = Number(sourceIndexText)
    if (Number.isNaN(sourceIndex) || dropIndex === null) return

    let insertionIndex = dropIndex
    if (sourceIndex < insertionIndex) insertionIndex -= 1
    if (insertionIndex < 0) insertionIndex = 0
    if (insertionIndex > rows.length - 1) insertionIndex = rows.length - 1

    if (insertionIndex === sourceIndex) {
      setDropIndex(null)
      setDraggingIndex(null)
      return
    }

    const ids = rows.map(getRowId)
    const [moved] = ids.splice(sourceIndex, 1)
    if (moved !== undefined) {
      ids.splice(insertionIndex, 0, moved)
      onRowsReorder?.(ids)
    }
    setDropIndex(null)
    setDraggingIndex(null)
  }, [dropIndex, rows, getRowId, onRowsReorder])

  // ── Imperative handle ──
  const tableRef = useRef<HTMLTableElement | null>(null)
  const bodyRef = useRef<HTMLTableSectionElement | null>(null)

  // ── Expose table height as a CSS variable so resize handles can span
  // the full table height (not just the header row).
  useEffect(() => {
    const table = tableRef.current
    if (!table) return
    const sync = (): void => {
      table.style.setProperty('--ecu-table-height', `${table.offsetHeight}px`)
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(table)
    return () => { ro.disconnect() }
  }, [])

  // ── Auto-width measurement ──
  // For each column with `autoWidth`, find the widest cell in the column
  // and set the matching <col> element's width directly in the DOM.
  // Writing straight to the DOM (rather than going through setState)
  // means the measurement and its application happen inside a single
  // layout-effect pass, before the browser paints — no flash of the
  // pre-measurement layout.
  const autoWidthColumnIds = useMemo(
    () => effectiveColumns.filter((c) => c.autoWidth && c.width === undefined).map((c) => c.id),
    [effectiveColumns]
  )
  useLayoutEffect(() => {
    const table = tableRef.current
    const body = bodyRef.current
    if (!table || !body || autoWidthColumnIds.length === 0) return
    for (const colId of autoWidthColumnIds) {
      const cells = body.querySelectorAll<HTMLElement>(`[data-col-id="${CSS.escape(colId)}"] > .ecu-table-auto-cell`)
      let maxWidth = 0
      cells.forEach((child) => {
        const w = child.getBoundingClientRect().width
        if (w > maxWidth) maxWidth = w
      })
      if (maxWidth === 0) continue
      // Add horizontal cell padding (default 2 * 6px = 12px) so the
      // content isn't flush against the right edge.
      const padded = Math.ceil(maxWidth) + 12
      const colEl = table.querySelector<HTMLTableColElement>(`col[data-col-id="${CSS.escape(colId)}"]`)
      if (colEl) colEl.style.width = `${padded}px`
    }
  })

  // ── FLIP animation: smoothly slide rows when their position changes ──
  // Records each row's top position after every render, compares with the
  // previous render, and animates the delta away with a transform.
  //
  // `flipReadyRef` is flipped to true after the initial layout has had
  // time to stabilize (two animation frames, long enough for autoWidth
  // measurement and any other post-mount reflow). Without this guard,
  // the setState from autoWidth triggers a re-render whose small layout
  // shifts get animated on mount — looks like rows are "flying in".
  const rowPositionsRef = useRef<Map<string, number>>(new Map())
  const flipReadyRef = useRef(false)
  useEffect(() => {
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => {
        flipReadyRef.current = true
      })
      return () => { cancelAnimationFrame(raf2) }
    })
    return () => { cancelAnimationFrame(raf1) }
  }, [])
  useLayoutEffect(() => {
    const body = bodyRef.current
    if (!body) return
    const prev = rowPositionsRef.current
    const next = new Map<string, number>()
    const rowEls = body.querySelectorAll<HTMLElement>('[data-row-id]')
    rowEls.forEach((el) => {
      const rowId = el.dataset['rowId']
      if (!rowId) return
      const top = el.getBoundingClientRect().top
      next.set(rowId, top)
      if (!flipReadyRef.current) return
      const prevTop = prev.get(rowId)
      if (prevTop !== undefined && prevTop !== top) {
        const delta = prevTop - top
        el.style.transform = `translateY(${delta}px)`
        el.style.transition = 'none'
        // Next frame: transition transform to 0
        requestAnimationFrame(() => {
          el.style.transform = ''
          el.style.transition = 'transform 180ms ease'
        })
      }
    })
    rowPositionsRef.current = next
  })

  useImperativeHandle(ref, () => ({
    focusRow: (rowId) => {
      const body = bodyRef.current
      if (!body) return
      const row = body.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(rowId)}"]`)
      if (!row) return
      const target = row.querySelector<HTMLElement>('input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])')
      target?.focus()
    },
    resetColumnWidths: () => {
      resetWidths()
    }
  }), [resetWidths])

  return (
    <table
      ref={tableRef}
      className="ecu-table"
      {...(dataTestId && { 'data-testid': dataTestId })}
    >
      <colgroup>
        {effectiveColumns.map((col) => {
          const w = widths[col.id]
          return (
            <col
              key={col.id}
              data-col-id={col.id}
              style={w !== undefined ? { width: `${w}px` } : undefined}
            />
          )
        })}
      </colgroup>
      <thead>
        <tr>
          {effectiveColumns.map((col, colIndex) => {
            const isResizable = !!col.resizable && col.width === undefined
            // Don't render a sash on the last resizable column — dragging
            // it right would just overflow the table.
            const lastResizableIndex = (() => {
              for (let i = effectiveColumns.length - 1; i >= 0; i--) {
                const c = effectiveColumns[i]
                if (c && !!c.resizable && c.width === undefined) return i
              }
              return -1
            })()
            const showSash = isResizable && colIndex !== lastResizableIndex
            return (
              <th
                key={col.id}
                data-col-id={col.id}
                className={showSash ? 'ecu-table-th--resizable' : undefined}
                {...(dataTestId && { 'data-testid': `${dataTestId}-header-${col.id}` })}
              >
                {col.header}
                {showSash && (
                  <span
                    className="ecu-table-resize-handle"
                    onMouseDown={(e) => { startResize(e, col.id) }}
                    {...(dataTestId && { 'data-testid': `${dataTestId}-resize-${col.id}` })}
                  />
                )}
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody ref={bodyRef}>
        {rows.map((row, index) => {
          const rowId = getRowId(row)
          const isDropBefore = dropIndex === index
          const isDropAfter = dropIndex === index + 1
          const isDragging = draggingIndex === index
          const rowClass = [
            'ecu-table-row',
            isDropBefore ? 'ecu-table-row--drop-before' : '',
            isDropAfter ? 'ecu-table-row--drop-after' : '',
            isDragging ? 'ecu-table-row--dragging' : ''
          ].filter(Boolean).join(' ')

          return (
            <tr
              key={rowId}
              data-row-id={rowId}
              className={rowClass}
              {...(dataTestId && { 'data-testid': `${dataTestId}-row-${rowId}` })}
              {...(reorderable && {
                onDragOver: (e: React.DragEvent<HTMLTableRowElement>) => {
                  e.preventDefault()
                  const rect = e.currentTarget.getBoundingClientRect()
                  const after = (e.clientY - rect.top) > rect.height / 2
                  setDropIndex(index + (after ? 1 : 0))
                },
                onDragLeave: (e: React.DragEvent<HTMLTableRowElement>) => {
                  if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
                  setDropIndex((current) => {
                    if (current === null) return null
                    return current === index || current === index + 1 ? null : current
                  })
                },
                onDrop: handleDrop,
                onDragEnd: () => {
                  setDropIndex(null)
                  setDraggingIndex(null)
                  cleanupGhost()
                }
              })}
            >
              {effectiveColumns.map((col) => {
                if (col.id === DRAG_COLUMN_ID) {
                  return (
                    <td key={col.id} data-col-id={col.id}>
                      <span
                        className="ecu-table-drag-handle"
                        draggable
                        onDragStart={(e) => {
                          e.stopPropagation()
                          handleDragStart(e, index)
                        }}
                        {...(dataTestId && { 'data-testid': `${dataTestId}-drag-${rowId}` })}
                      >⋮⋮</span>
                    </td>
                  )
                }
                const isAutoCol = col.autoWidth && col.width === undefined
                return (
                  <td
                    key={col.id}
                    data-col-id={col.id}
                    {...(dataTestId && { 'data-testid': `${dataTestId}-cell-${rowId}-${col.id}` })}
                  >
                    {isAutoCol
                      ? <span className="ecu-table-auto-cell">{col.renderCell(row)}</span>
                      : col.renderCell(row)}
                  </td>
                )
              })}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/**
 * Generic, controlled table with optional resizable columns and row
 * reordering. See the README for full usage examples.
 */
export const Table = forwardRef(TableInner) as <TRow>(
  props: TableProps<TRow> & { ref?: ForwardedRef<TableHandle> }
) => ReactElement
