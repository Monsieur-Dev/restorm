import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ContextMenuItem, EditorTab, EditorWorkbenchHandle, GroupNode, WorkbenchTree } from 'electron-core-ui/renderer'
import { EditorWorkbench, Workbench, isContainerNode, isTabGroupNode, logger } from 'electron-core-ui/renderer'

interface TabDef {
  id: string
  titleKey: string
  contentKey: string
  allowFullscreen?: boolean
}

interface WorkbenchTabDroppedData {
  tabId: string
  title: string
  groupId: string
  content?: string
  cursorX?: number
  cursorY?: number
}

interface WorkbenchTabDroppedMessage {
  type: 'workbench-tab-dropped'
  targetWindowId: number
  tabData: WorkbenchTabDroppedData
}

const WORKBENCH_TEST_ID = 'workbench-basic'
const WORKBENCH_STORAGE_ID = 'demo-workbench-e2e'
const WORKBENCH_BROADCAST_CHANNEL = 'workbench-e2e'

const EditorWorkbenchTab: React.FC = () => {
  const { t } = useTranslation()

  const tabDefs: TabDef[] = useMemo(() => ([
    { id: 'tab-a', titleKey: 'workbench.harness.tabs.a.title', contentKey: 'workbench.harness.tabs.a.content' },
    { id: 'tab-b', titleKey: 'workbench.harness.tabs.b.title', contentKey: 'workbench.harness.tabs.b.content' },
    { id: 'tab-c', titleKey: 'workbench.harness.tabs.c.title', contentKey: 'workbench.harness.tabs.c.content', allowFullscreen: true },
    { id: 'tab-d', titleKey: 'workbench.harness.tabs.d.title', contentKey: 'workbench.harness.tabs.d.content' }
  ]), [])

  const tabById = useMemo(() => {
    const map = new Map<string, TabDef>()
    for (const def of tabDefs) map.set(def.id, def)
    return map
  }, [tabDefs])

  const buildTab = useCallback((tabId: string): EditorTab | null => {
    const def = tabById.get(tabId)
    if (!def) return null
    return {
      id: def.id,
      title: t(def.titleKey),
      titleString: t(def.titleKey),
      ...(def.allowFullscreen !== undefined && { allowFullscreen: def.allowFullscreen }),
    }
  }, [t, tabById])

  const renderTabContent = useCallback((tab: EditorTab) => {
    const def = tabById.get(tab.id)
    const content = def ? t(def.contentKey) : ''
    return (
      <div data-testid={`workbench-content-${tab.id}`} style={{ padding: 12 }}>
        {content}
      </div>
    )
  }, [t, tabById])

  const onGetTabContent = useCallback((tabId: string): string | undefined => {
    const def = tabById.get(tabId)
    if (!def) return undefined
    return t(def.contentKey)
  }, [t, tabById])

  const initialTree = useMemo<WorkbenchTree>(() => ({
    orientation: 'vertical',
    groups: [
      {
        id: 'group-left',
        tabs: ['tab-a', 'tab-b'].map((id) => buildTab(id)).filter((t): t is EditorTab => t !== null),
        activeTabId: 'tab-a'
      },
      {
        id: 'group-right',
        tabs: ['tab-c', 'tab-d'].map((id) => buildTab(id)).filter((t): t is EditorTab => t !== null),
        activeTabId: 'tab-c'
      }
    ],
    sizes: [0.55, 0.45]
  }), [buildTab])

  const [tree, setTree] = useState<WorkbenchTree>(initialTree)
  const [eventCount, setEventCount] = useState(0)
  const [lastEvent, setLastEvent] = useState('')
  const [ipcMode, setIpcMode] = useState<'inside' | 'create' | 'send'>('inside')
  const [auxWindowId, setAuxWindowId] = useState<number | null>(null)
  const ipcModeRef = useRef<'inside' | 'create' | 'send'>('inside')
  const auxWindowIdRef = useRef<number | null>(null)

  useEffect(() => {
    ipcModeRef.current = ipcMode
  }, [ipcMode])

  useEffect(() => {
    auxWindowIdRef.current = auxWindowId
  }, [auxWindowId])

  const onChange = useCallback((next: WorkbenchTree) => {
    setTree(next)
    setEventCount((c) => c + 1)
    setLastEvent('change')
  }, [])

  const onActivateTab = useCallback((tabId: string, groupId: string) => {
    setEventCount((c) => c + 1)
    setLastEvent(`activate:${groupId}:${tabId}`)
  }, [])

  const getTabContextMenuItems = useCallback(
    (_tab: EditorTab, groupId: string, actions: { close: () => void; closeOthersInGroup: () => void }): ContextMenuItem[] => {
      return [
        {
          id: 'close',
          label: t('workbench.harness.contextMenu.close'),
          onClick: () => {
            actions.close()
            setEventCount((c) => c + 1)
            setLastEvent(`contextmenu:${groupId}:close`)
          }
        },
        {
          id: 'close-others',
          label: t('workbench.harness.contextMenu.closeOthers'),
          onClick: () => {
            actions.closeOthersInGroup()
            setEventCount((c) => c + 1)
            setLastEvent(`contextmenu:${groupId}:closeOthers`)
          }
        }
      ]
    },
    [t]
  )

  const onSizesChange = useCallback((nodeId: string, sizes: number[]) => {
    const rounded = sizes.map((s) => Math.round(s * 1000) / 1000).join(',')
    setEventCount((c) => c + 1)
    setLastEvent(`sizes:${nodeId}:${rounded}`)
  }, [])

  const treeSnapshot = useMemo(() => {
    const snapshotNode = (node: GroupNode): unknown => {
      if (isTabGroupNode(node)) {
        return {
          type: 'tabs',
          id: node.id,
          activeTabId: node.activeTabId ?? '',
          tabs: node.tabs.map((t) => ({
            id: t.id,
            titleString: t.titleString ?? '',
            isDirty: t.isDirty ? true : false
          }))
        }
      }
      if (isContainerNode(node)) {
        return {
          type: 'container',
          id: node.id,
          orientation: node.orientation,
          sizes: node.sizes ?? [],
          groups: node.groups.map(snapshotNode)
        }
      }
      return null
    }

    return {
      orientation: tree.orientation,
      sizes: tree.sizes ?? [],
      groups: tree.groups.map(snapshotNode)
    }
  }, [tree])

  const treeJson = useMemo(() => JSON.stringify(treeSnapshot), [treeSnapshot])

  const resetToInitial = useCallback(() => {
    setTree(initialTree)
    setEventCount((c) => c + 1)
    setLastEvent('reset')
  }, [initialTree])

  const workbenchRef = useRef<EditorWorkbenchHandle | null>(null)

  useEffect(() => {
    const original = {
      getCursorScreenPoint: window.api.getCursorScreenPoint,
      getCurrentWindowBounds: window.api.getCurrentWindowBounds,
      getWindowUnderCursor: window.api.getWindowUnderCursor,
      createAuxWindow: window.api.createAuxWindow,
      sendWorkbenchTabToWindow: window.api.sendWorkbenchTabToWindow,
      onWorkbenchTabDropped: window.api.onWorkbenchTabDropped
    }

    const currentWindowId = 1
    let nextWindowId = 100

    const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(WORKBENCH_BROADCAST_CHANNEL) : null

    const openAuxWindow = (): { win: Window; windowId: number } => {
      const win = window.open('about:blank', '_blank', 'width=600,height=400')
      if (!win) {
        throw new Error('Failed to open auxiliary window')
      }
      const windowId = nextWindowId++

      const doc = win.document
      doc.title = 'Workbench Aux'
      const body = doc.body
      body.innerHTML = ''

      const mk = (testId: string, text = ''): HTMLDivElement => {
        const el = doc.createElement('div')
        el.setAttribute('data-testid', testId)
        el.textContent = text
        return el
      }

      body.appendChild(mk('aux-ready', 'true'))
      body.appendChild(mk('aux-window-id', String(windowId)))
      body.appendChild(mk('aux-last-dropped-tab-id'))
      body.appendChild(mk('aux-last-dropped-title'))
      body.appendChild(mk('aux-last-dropped-content'))

      const script = doc.createElement('script')
      script.textContent = `(function () {
  const WORKBENCH_BROADCAST_CHANNEL = ${JSON.stringify(WORKBENCH_BROADCAST_CHANNEL)};
  const currentWindowId = ${String(windowId)};
  let onDropped = null;

  window.api = window.api || {};
  window.api.onWorkbenchTabDropped = function (cb) {
    onDropped = cb;
    return function () { onDropped = null; };
  };

  const bc = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel(WORKBENCH_BROADCAST_CHANNEL) : null;
  if (!bc) return;

  bc.onmessage = function (ev) {
    const msg = ev && ev.data;
    if (!msg || msg.type !== 'workbench-tab-dropped') return;
    if (msg.targetWindowId !== currentWindowId) return;
    const tabData = msg.tabData || {};
    const id = (typeof tabData.tabId === 'string') ? tabData.tabId : '';
    const title = (typeof tabData.title === 'string') ? tabData.title : '';
    const content = (typeof tabData.content === 'string') ? tabData.content : '';

    const idEl = document.querySelector('[data-testid="aux-last-dropped-tab-id"]');
    const titleEl = document.querySelector('[data-testid="aux-last-dropped-title"]');
    const contentEl = document.querySelector('[data-testid="aux-last-dropped-content"]');
    if (idEl) idEl.textContent = id;
    if (titleEl) titleEl.textContent = title;
    if (contentEl) contentEl.textContent = content;

    if (typeof onDropped === 'function') {
      try { onDropped(tabData); } catch (e) { /* noop */ }
    }
  };
})();`
      body.appendChild(script)

      return { win, windowId }
    }

    const onDroppedListeners = new Set<(tabData: unknown) => void>()

    const apiShim = {
      getCursorScreenPoint: (): Promise<{ x: number; y: number }> => {
        return Promise.resolve(ipcModeRef.current === 'inside' ? { x: 10, y: 10 } : { x: -1000, y: -1000 })
      },
      getCurrentWindowBounds: (): Promise<{ x: number; y: number; width: number; height: number; windowId: number }> => Promise.resolve({
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        windowId: currentWindowId
      }),
      getWindowUnderCursor: (): Promise<{ windowId: number; bounds: { x: number; y: number; width: number; height: number } } | null> => {
        if (ipcModeRef.current !== 'send') return Promise.resolve(null)
        if (auxWindowIdRef.current === null) return Promise.resolve(null)
        return Promise.resolve({ windowId: auxWindowIdRef.current, bounds: { x: 0, y: 0, width: 600, height: 400 } })
      },
      createAuxWindow: (_payload: { editorId: string; title: string }, _bounds: { x: number; y: number; width?: number; height?: number }): Promise<void> => {
        try {
          const { windowId } = openAuxWindow()
          setAuxWindowId(windowId)
        } catch (error) {
          logger.error('EditorWorkbenchTab: createAuxWindow shim failed', { error: String(error) })
        }
        return Promise.resolve()
      },
      sendWorkbenchTabToWindow: (targetWindowId: number, tabData: WorkbenchTabDroppedData): Promise<boolean> => {
        if (!bc) return Promise.resolve(false)
        const msg: WorkbenchTabDroppedMessage = { type: 'workbench-tab-dropped', targetWindowId, tabData }
        bc.postMessage(msg)
        return Promise.resolve(true)
      },
      onWorkbenchTabDropped: (callback: (tabData: unknown) => void): (() => void) => {
        onDroppedListeners.add(callback)
        return () => { onDroppedListeners.delete(callback) }
      }
    }

    // Main window listener: dispatch to registered callbacks when a message is addressed to this window id
    if (bc) {
      bc.onmessage = (ev: MessageEvent<unknown>) => {
        const msg = ev.data as Partial<WorkbenchTabDroppedMessage> | null
        if (msg?.type !== 'workbench-tab-dropped') return
        if (msg.targetWindowId !== currentWindowId) return
        for (const cb of onDroppedListeners) {
          try { cb(msg.tabData) } catch { /* noop */ }
        }
      }
    }

    Object.assign(window.api, apiShim)

    return () => {
      bc?.close()
      window.api.getCursorScreenPoint = original.getCursorScreenPoint
      window.api.getCurrentWindowBounds = original.getCurrentWindowBounds
      window.api.getWindowUnderCursor = original.getWindowUnderCursor
      window.api.createAuxWindow = original.createAuxWindow
      window.api.sendWorkbenchTabToWindow = original.sendWorkbenchTabToWindow
      window.api.onWorkbenchTabDropped = original.onWorkbenchTabDropped
    }
  }, [])

  const manualSave = useCallback(async () => {
    try {
      if (!workbenchRef.current) throw new Error('Workbench ref is not ready')
      const ok = await workbenchRef.current.saveState()
      setEventCount((c) => c + 1)
      setLastEvent(`save:${String(ok)}`)
    } catch (error) {
      logger.error('EditorWorkbenchTab: manual save failed', { error: String(error) })
      setEventCount((c) => c + 1)
      setLastEvent('save:error')
    }
  }, [])

  const manualLoad = useCallback(async () => {
    try {
      if (!workbenchRef.current) throw new Error('Workbench ref is not ready')
      const restored = await workbenchRef.current.loadState()
      if (restored) {
        setTree(restored)
      }
      setEventCount((c) => c + 1)
      setLastEvent(`load:${restored ? 'true' : 'false'}`)
    } catch (error) {
      logger.error('EditorWorkbenchTab: manual load failed', { error: String(error) })
      setEventCount((c) => c + 1)
      setLastEvent('load:error')
    }
  }, [])

  const manualClear = useCallback(async () => {
    try {
      if (!workbenchRef.current) throw new Error('Workbench ref is not ready')
      const ok = await workbenchRef.current.clearState()
      setEventCount((c) => c + 1)
      setLastEvent(`clear:${String(ok)}`)
    } catch (error) {
      logger.error('EditorWorkbenchTab: manual clear failed', { error: String(error) })
      setEventCount((c) => c + 1)
      setLastEvent('clear:error')
    }
  }, [])

  return (
    <div style={{ height: '100%', minHeight: 0 }}>
      <Workbench data-testid="workbench-wrapper">
        <div style={{ display: 'grid', gap: 12, padding: 12, height: '100%', minHeight: 0 }}>
        <div data-testid="editorworkbench-ready">true</div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button data-testid="editorworkbench-reset" onClick={resetToInitial}>
            {t('workbench.harness.actions.reset')}
          </button>
          <button data-testid="editorworkbench-save" onClick={() => { void manualSave() }}>
            {t('workbench.harness.actions.save')}
          </button>
          <button data-testid="editorworkbench-load" onClick={() => { void manualLoad() }}>
            {t('workbench.harness.actions.load')}
          </button>
          <button data-testid="editorworkbench-clear" onClick={() => { void manualClear() }}>
            {t('workbench.harness.actions.clear')}
          </button>
          <button
            data-testid="editorworkbench-open-aux-window"
            onClick={() => {
              void window.api.createAuxWindow({ editorId: 'aux', title: 'Aux' }, { x: 0, y: 0, width: 600, height: 400 })
            }}
          >
            {t('workbench.harness.actions.openAux')}
          </button>
          <button data-testid="editorworkbench-ipc-mode-create" onClick={() => { setIpcMode('create') }}>
            {t('workbench.harness.actions.ipcCreate')}
          </button>
          <button data-testid="editorworkbench-ipc-mode-send" onClick={() => { setIpcMode('send') }}>
            {t('workbench.harness.actions.ipcSend')}
          </button>
          <button data-testid="editorworkbench-ipc-mode-inside" onClick={() => { setIpcMode('inside') }}>
            {t('workbench.harness.actions.ipcInside')}
          </button>
        </div>

        <div style={{ border: '1px solid var(--panel-border)', height: 520, overflow: 'hidden', minHeight: 0 }}>
          <EditorWorkbench
            ref={workbenchRef}
            data-testid={WORKBENCH_TEST_ID}
            tree={tree}
            onChange={onChange}
            onActivateTab={onActivateTab}
            getTabContextMenuItems={getTabContextMenuItems}
            renderTabContent={renderTabContent}
            onGetTabContent={onGetTabContent}
            onSizesChange={onSizesChange}
            workbenchId={WORKBENCH_STORAGE_ID}
            autosave
            onRebuildTab={buildTab}
          />
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          <div data-testid="editorworkbench-event-count">{String(eventCount)}</div>
          <div data-testid="editorworkbench-last-event">{lastEvent}</div>
          <div data-testid="editorworkbench-tree-json">{treeJson}</div>
          <div data-testid="editorworkbench-storage-id">{WORKBENCH_STORAGE_ID}</div>
          <div data-testid="editorworkbench-ipc-mode">{ipcMode}</div>
          <div data-testid="editorworkbench-aux-window-id">{auxWindowId === null ? '' : String(auxWindowId)}</div>
        </div>
        </div>
      </Workbench>
    </div>
  )
}

export default EditorWorkbenchTab
