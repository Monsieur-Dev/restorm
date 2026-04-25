/**
 * ODataExpandEditor — nested `$expand` builder.
 *
 * Parses the raw clause into a tree (via shared `parseExpand`), lets
 * the user add / reorder / remove navigation properties per level,
 * edit nested `$select` / `$filter` / `$top` / `$skip` / `$orderby`
 * inline, and recurse into child expands. Serializes back through
 * `serializeExpand` on every edit so the canonical clause stays
 * stable.
 */

import React, { useCallback, useMemo, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  InputBox
} from 'electron-core-ui/renderer'
import {
  parseExpand,
  serializeExpand,
  type ExpandNode
} from '../../../../shared/utils/odataExpand'

const cardStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: 8,
  border: '1px solid var(--panel-border)',
  borderRadius: 4,
  background: 'var(--sideBar-background)'
}
const rowStyle: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }
const propertyWrapperStyle: CSSProperties = { flex: 1, minWidth: 160 }
const buttonRowStyle: CSSProperties = { display: 'flex', gap: 4, marginLeft: 'auto' }
const labelStyle: CSSProperties = { fontSize: 12, color: 'var(--descriptionForeground)' }
const smallLabelStyle: CSSProperties = { ...labelStyle, minWidth: 60 }
const optionsGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto 1fr',
  gap: 6,
  alignItems: 'center',
  paddingLeft: 12
}
const nestedWrapperStyle: CSSProperties = { paddingLeft: 12 }

function newExpandNode(): ExpandNode {
  return { id: crypto.randomUUID(), property: '' }
}

interface ExpandRowProps {
  node: ExpandNode
  index: number
  count: number
  onUpdate: (index: number, next: ExpandNode) => void
  onRemove: (index: number) => void
  onMove: (index: number, delta: number) => void
  testIdPrefix: string
}

const ExpandRow: React.FC<ExpandRowProps> = ({ node, index, count, onUpdate, onRemove, onMove, testIdPrefix }) => {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  const patch = useCallback((fields: Partial<ExpandNode>): void => {
    onUpdate(index, { ...node, ...fields })
  }, [index, node, onUpdate])

  const clearField = useCallback((key: keyof ExpandNode): void => {
    const {
      select: _sel,
      filter: _fil,
      top: _top,
      skip: _skip,
      orderby: _ord,
      expand: _exp,
      ...base
    } = node
    const kept: Partial<ExpandNode> = {}
    if (key !== 'select' && _sel !== undefined) kept.select = _sel
    if (key !== 'filter' && _fil !== undefined) kept.filter = _fil
    if (key !== 'top' && _top !== undefined) kept.top = _top
    if (key !== 'skip' && _skip !== undefined) kept.skip = _skip
    if (key !== 'orderby' && _ord !== undefined) kept.orderby = _ord
    if (key !== 'expand' && _exp !== undefined) kept.expand = _exp
    onUpdate(index, { ...base, ...kept })
  }, [index, node, onUpdate])

  const setSelect = (raw: string): void => {
    const list = raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
    if (list.length > 0) {
      patch({ select: list })
    } else {
      clearField('select')
    }
  }

  const setNestedExpand = useCallback((nextChildren: ExpandNode[]) => {
    if (nextChildren.length === 0) {
      clearField('expand')
      return
    }
    patch({ expand: nextChildren })
  }, [patch, clearField])

  return (
    <div style={cardStyle} data-testid={`${testIdPrefix}-${index}`}>
      <div style={rowStyle}>
        <div style={propertyWrapperStyle}>
          <InputBox
            value={node.property}
            onChange={(property: string) => { patch({ property }) }}
            options={{ placeholder: t('odataRequestTab.expandPropertyPlaceholder', 'Navigation property (e.g. Tags)') }}
            data-testid={`${testIdPrefix}-property-${index}`}
          />
        </div>
        <div style={buttonRowStyle}>
          <Button
            icon={expanded ? 'chevron-up' : 'chevron-down'}
            onClick={() => { setExpanded(!expanded) }}
            options={{
              ariaLabel: expanded
                ? t('odataRequestTab.expandCollapseOptions', 'Hide options')
                : t('odataRequestTab.expandShowOptions', 'Show options'),
              title: expanded
                ? t('odataRequestTab.expandCollapseOptions', 'Hide options')
                : t('odataRequestTab.expandShowOptions', 'Show options')
            }}
            data-testid={`${testIdPrefix}-toggle-${index}`}
          />
          <Button
            icon="arrow-up"
            onClick={() => { onMove(index, -1) }}
            options={{
              ariaLabel: t('odataRequestTab.expandMoveUp', 'Move up'),
              title: t('odataRequestTab.expandMoveUp', 'Move up')
            }}
            data-testid={`${testIdPrefix}-move-up-${index}`}
            disabled={index === 0}
          />
          <Button
            icon="arrow-down"
            onClick={() => { onMove(index, 1) }}
            options={{
              ariaLabel: t('odataRequestTab.expandMoveDown', 'Move down'),
              title: t('odataRequestTab.expandMoveDown', 'Move down')
            }}
            data-testid={`${testIdPrefix}-move-down-${index}`}
            disabled={index === count - 1}
          />
          <Button
            icon="trash"
            onClick={() => { onRemove(index) }}
            options={{
              ariaLabel: t('odataRequestTab.expandRemove', 'Remove'),
              title: t('odataRequestTab.expandRemove', 'Remove')
            }}
            data-testid={`${testIdPrefix}-remove-${index}`}
          />
        </div>
      </div>

      {expanded ? (
        <>
          <div style={optionsGridStyle}>
            <span style={smallLabelStyle}>$select</span>
            <InputBox
              value={(node.select ?? []).join(', ')}
              onChange={setSelect}
              options={{ placeholder: t('odataRequestTab.expandSelectPlaceholder', 'Id, Name (comma-separated)') }}
              data-testid={`${testIdPrefix}-select-${index}`}
            />
            <span style={smallLabelStyle}>$filter</span>
            <InputBox
              value={node.filter ?? ''}
              onChange={(filter: string) => {
                if (filter) patch({ filter })
                else clearField('filter')
              }}
              options={{ placeholder: t('odataRequestTab.expandFilterPlaceholder', "Name eq 'x'") }}
              data-testid={`${testIdPrefix}-filter-${index}`}
            />
            <span style={smallLabelStyle}>$top</span>
            <InputBox
              value={node.top ?? ''}
              onChange={(top: string) => {
                if (top) patch({ top })
                else clearField('top')
              }}
              options={{
                type: 'number',
                min: 0,
                step: 1,
                placeholder: t('odataRequestTab.expandTopPlaceholder', '5')
              }}
              data-testid={`${testIdPrefix}-top-${index}`}
            />
            <span style={smallLabelStyle}>$skip</span>
            <InputBox
              value={node.skip ?? ''}
              onChange={(skip: string) => {
                if (skip) patch({ skip })
                else clearField('skip')
              }}
              options={{
                type: 'number',
                min: 0,
                step: 1,
                placeholder: t('odataRequestTab.expandSkipPlaceholder', '0')
              }}
              data-testid={`${testIdPrefix}-skip-${index}`}
            />
            <span style={smallLabelStyle}>$orderby</span>
            <InputBox
              value={node.orderby ?? ''}
              onChange={(orderby: string) => {
                if (orderby) patch({ orderby })
                else clearField('orderby')
              }}
              options={{ placeholder: t('odataRequestTab.expandOrderbyPlaceholder', 'Name asc') }}
              data-testid={`${testIdPrefix}-orderby-${index}`}
            />
          </div>
          <div style={nestedWrapperStyle}>
            <span style={{ ...labelStyle, marginBottom: 4, display: 'block' }}>
              {t('odataRequestTab.expandNested', 'Nested $expand')}
            </span>
            <NestedExpandList
              value={node.expand ?? []}
              onChange={setNestedExpand}
              testIdPrefix={`${testIdPrefix}-nested-${index}`}
            />
          </div>
        </>
      ) : null}
    </div>
  )
}

interface NestedExpandListProps {
  value: readonly ExpandNode[]
  onChange: (next: ExpandNode[]) => void
  testIdPrefix: string
}

const NestedExpandList: React.FC<NestedExpandListProps> = ({ value, onChange, testIdPrefix }) => {
  const { t } = useTranslation()

  const update = useCallback((index: number, next: ExpandNode): void => {
    const out = value.slice()
    out[index] = next
    onChange(out)
  }, [value, onChange])

  const remove = useCallback((index: number): void => {
    const out = value.slice()
    out.splice(index, 1)
    onChange(out)
  }, [value, onChange])

  const move = useCallback((index: number, delta: number): void => {
    const target = index + delta
    if (target < 0 || target >= value.length) return
    const out = value.slice()
    const [item] = out.splice(index, 1)
    if (!item) return
    out.splice(target, 0, item)
    onChange(out)
  }, [value, onChange])

  const add = useCallback((): void => {
    onChange([...value, newExpandNode()])
  }, [value, onChange])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {value.length === 0 ? (
        <span style={{ ...labelStyle, fontStyle: 'italic' }}>
          {t('odataRequestTab.expandEmpty', 'No expansions yet. Add one below.')}
        </span>
      ) : null}
      {value.map((node, index) => (
        <ExpandRow
          key={node.id}
          node={node}
          index={index}
          count={value.length}
          onUpdate={update}
          onRemove={remove}
          onMove={move}
          testIdPrefix={testIdPrefix}
        />
      ))}
      <div>
        <Button
          icon="add"
          onClick={add}
          options={{
            ariaLabel: t('odataRequestTab.expandAdd', 'Add expansion'),
            title: t('odataRequestTab.expandAdd', 'Add expansion')
          }}
          data-testid={`${testIdPrefix}-add`}
        >
          {t('odataRequestTab.expandAdd', 'Add expansion')}
        </Button>
      </div>
    </div>
  )
}

export interface ODataExpandEditorProps {
  value: string | undefined
  onChange: (next: string) => void
}

export const ODataExpandEditor: React.FC<ODataExpandEditorProps> = ({ value, onChange }) => {
  const nodes = useMemo(() => parseExpand(value), [value])

  const emit = useCallback((next: ExpandNode[]): void => {
    onChange(serializeExpand(next))
  }, [onChange])

  return <NestedExpandList value={nodes} onChange={emit} testIdPrefix="odata-expand" />
}
