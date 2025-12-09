import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ListView,
  type ListViewItemData,
  Sash,
  type IVerticalSashLayoutProvider,
  type SashEvent,
  SplitView,
  Pane,
  Button,
  Tabs,
  type Tab,
  MarkdownEditor
} from 'electron-core-ui/renderer'
import { ParamsTabView } from './ParamsTabView'
import type { ParamsTabViewHandle } from './ParamsTabView'
import type { Folder, Environment } from '../types/collections'

const MIN_LEFT_WIDTH = 160
const RIGHT_MIN_WIDTH = 240

export interface FolderViewProps {
  /** The folder to display */
  folder: Folder
}

/** Convert environments to ListView items */
function environmentsToListViewItems(
  environments: Environment[],
  expandedIds: string[]
): ListViewItemData[] {
  return environments.map((env) => ({
    id: env.id,
    title: env.name,
    isExpandable: (env.subEnvironments?.length ?? 0) > 0,
    isExpanded: expandedIds.includes(env.id),
    icon: expandedIds.includes(env.id) ? 'folder-opened' : 'folder',
    children: env.subEnvironments
      ? environmentsToListViewItems(env.subEnvironments, expandedIds)
      : []
  }))
}

/** Collect all environment IDs recursively */
function collectEnvironmentIds(environments: Environment[]): string[] {
  const ids: string[] = []
  for (const env of environments) {
    ids.push(env.id)
    if (env.subEnvironments) {
      ids.push(...collectEnvironmentIds(env.subEnvironments))
    }
  }
  return ids
}

export const FolderView: React.FC<FolderViewProps> = ({ folder }) => {
  const { t } = useTranslation()
  const [activeTabId, setActiveTabId] = useState<string>('configuration')

  // Initialize with all environments expanded
  const allEnvIds = useMemo(
    () => collectEnvironmentIds(folder.configuration.environments),
    [folder.configuration.environments]
  )
  const [expandedIds, setExpandedIds] = useState<string[]>(allEnvIds)

  // Convert environments to ListView items
  const sidebarItems: ListViewItemData[] = useMemo(
    () => environmentsToListViewItems(folder.configuration.environments, expandedIds),
    [folder.configuration.environments, expandedIds]
  )

  const containerRef = useRef<HTMLDivElement | null>(null)
  const [leftWidth, setLeftWidth] = useState<number>(220)
  const [containerHeight, setContainerHeight] = useState<number>(0)
  const sashStartLeftRef = useRef<number>(leftWidth)
  const variablesParamsRef = useRef<ParamsTabViewHandle | null>(null)

  const layoutProvider: IVerticalSashLayoutProvider = useMemo(
    () => ({
      getVerticalSashLeft: () => leftWidth,
      getVerticalSashTop: () => 0,
      getVerticalSashHeight: () => containerHeight
    }),
    [leftWidth, containerHeight]
  )

  const handleSashStart = useCallback(
    (_event: SashEvent): void => {
      sashStartLeftRef.current = leftWidth
    },
    [leftWidth]
  )

  const handleSashChange = useCallback(
    (event: SashEvent): void => {
      if (!containerRef.current) return

      const delta = event.currentX - event.startX
      const containerWidth = containerRef.current.clientWidth
      const min = MIN_LEFT_WIDTH
      const max = Math.max(min, containerWidth - RIGHT_MIN_WIDTH)
      const start = sashStartLeftRef.current
      const next = Math.min(max, Math.max(min, start + delta))

      setLeftWidth(next)
    },
    []
  )

  useEffect(() => {
    if (!containerRef.current) {
      return
    }
    const observer = new ResizeObserver(() => {
      const el = containerRef.current
      if (el) {
        setContainerHeight(el.clientHeight)
      }
    })
    observer.observe(containerRef.current)
    return () => {
      observer.disconnect()
    }
  }, [])

  const configurationContent = (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        position: 'relative',
        flex: 1,
        minHeight: 0,
        minWidth: 0
      }}
    >
      <div
        style={{
          width: leftWidth,
          minWidth: MIN_LEFT_WIDTH,
          maxWidth: '70%',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          borderRight: '1px solid var(--vscode-sideBar-border, var(--vscode-panel-border))',
          backgroundColor: 'var(--vscode-sideBar-background)'
        }}
      >
        <SplitView
          orientation="vertical"
          style={{ width: '100%', height: '100%' }}
        >
          <Pane
            title={t('folderView.environments')}
            collapsible={false}
            minSize={MIN_LEFT_WIDTH}
            headerActions={
              <>
                <Button
                  secondary
                  small
                  options={{ ariaLabel: t('sidebar.addRequest'), title: t('sidebar.addRequest') }}
                  onClick={() => {
                    // TODO: hook this to real "add environment" behavior
                  }}
                >
                  <i className="codicon codicon-add" />
                </Button>
                <Button
                  secondary
                  small
                  options={{ ariaLabel: t('sidebar.collapseAll'), title: t('sidebar.collapseAll') }}
                  onClick={() => {
                    setExpandedIds([])
                  }}
                >
                  <i className="codicon codicon-collapse-all" />
                </Button>
              </>
            }
          >
            <ListView
              items={sidebarItems}
              rootRole="tree"
              ariaLabel={t('folderView.environmentsAriaLabel')}
              onItemToggle={(payload, expanded) => {
                const id = payload.item.id
                if (!id) return
                setExpandedIds((prev) =>
                  expanded
                    ? Array.from(new Set([...prev, id]))
                    : prev.filter((existingId) => existingId !== id)
                )
              }}
            />
          </Pane>
        </SplitView>
      </div>

      <div
        style={{
          flex: 1,
          minWidth: RIGHT_MIN_WIDTH,
          minHeight: 0,
          display: 'flex',
          boxSizing: 'border-box',
          backgroundColor: 'var(--vscode-editor-background)'
        }}
      >
        <SplitView
          orientation="vertical"
          style={{ width: '100%', height: '100%' }}
        >
          <Pane
            title={t('folderView.variables')}
            collapsible={false}
            minSize={80}
            headerActions={
              <Button
                secondary
                small
                options={{ ariaLabel: t('folderView.addVariable'), title: t('folderView.addVariable') }}
                onClick={() => {
                  variablesParamsRef.current?.addRow()
                }}
              >
                <i className="codicon codicon-add" />
              </Button>
            }
          >
            <div
              style={{
                padding: '8px 8px 4px 8px',
                boxSizing: 'border-box'
              }}
            >
              <ParamsTabView ref={variablesParamsRef} variables={[]} />
            </div>
          </Pane>
        </SplitView>
      </div>

      <Sash
        orientation="vertical"
        layoutProvider={layoutProvider}
        onStart={handleSashStart}
        onChange={handleSashChange}
        size={4}
      />
    </div>
  )

  const tabs: Tab[] = [
    {
      id: 'docs',
      label: t('folderView.tabs.docs'),
      useScrollableElement: false,
      content: (
        <MarkdownEditor
          initialValue={folder.documentation || `# ${folder.name}\n\nNo documentation available.`}
        />
      )
    },
    {
      id: 'configuration',
      label: t('folderView.tabs.configuration'),
      useScrollableElement: false,
      content: configurationContent
    }
  ]

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        minWidth: 0
      }}
    >
      <Tabs
        tabs={tabs}
        activeTabId={activeTabId}
        onTabChange={setActiveTabId}
      />
    </div>
  )
}

export default FolderView
