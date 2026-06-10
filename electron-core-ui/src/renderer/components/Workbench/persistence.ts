import type { WorkbenchTree, GroupNode, ContainerGroupNode, TabGroupNode, Orientation, EditorTab } from './types';
import { isTabGroupNode } from './types';
import { saveToStorage, loadFromStorage } from '../../hooks/useStorage';

/**
 * Persisted state for a single group node (can be tabs or container)
 */
export interface PersistedGroupNode {
  type: 'tabs' | 'container';
  id: string;
  /** For tabs: list of tab IDs */
  tabIds?: string[] | undefined;
  /**
   * For tabs: optional parallel array of per-tab persisted state.
   * Index N matches `tabIds[N]`. Entries are whatever the consumer
   * stored on `EditorTab.persistedState` at extract time; `null`
   * means "this tab opted out of state persistence". Older saves
   * predating this field round-trip cleanly — the rebuild callback
   * just receives `undefined` for the data argument.
   */
  tabData?: unknown[] | undefined;
  /** For tabs: active tab ID */
  activeTabId?: string | undefined;
  /** For container: orientation */
  orientation?: Orientation | undefined;
  /** For container: child groups */
  children?: PersistedGroupNode[] | undefined;
  /** Sizes (ratios 0-1) for container children */
  sizes?: number[] | undefined;
}

/**
 * Persisted workbench state
 */
export interface PersistedWorkbenchState {
  /** Root orientation */
  orientation: Orientation;
  /** Hierarchical groups */
  groups: PersistedGroupNode[];
  /** Sizes of root-level groups (ratios 0-1) */
  sizes?: number[] | undefined;
}

/**
 * Extract persistable state from WorkbenchTree (hierarchical)
 */
export function extractWorkbenchState(tree: WorkbenchTree): PersistedWorkbenchState {
  const extractNode = (node: GroupNode): PersistedGroupNode => {
    if (isTabGroupNode(node)) {
      // Capture each tab's opt-in `persistedState`. The parallel
      // array stays empty when no tab in the group has any state
      // to persist — keeps the on-disk shape lean for the common
      // (stateless) case.
      const tabData = node.tabs.map(t => t.persistedState ?? null);
      const hasAnyData = tabData.some(d => d !== null);
      return {
        type: 'tabs',
        id: node.id,
        tabIds: node.tabs.map(t => t.id),
        ...(hasAnyData ? { tabData } : {}),
        activeTabId: node.activeTabId
      };
    } else {
      // ContainerGroupNode
      return {
        type: 'container',
        id: node.id,
        orientation: node.orientation,
        children: node.groups.map(extractNode),
        sizes: node.sizes
      };
    }
  };
  
  return {
    orientation: tree.orientation,
    groups: tree.groups.map(extractNode),
    sizes: tree.sizes
  };
}

/**
 * Callback to rebuild a tab from its persisted id + optional state.
 * Returns the EditorTab or null if not found.
 *
 * `data` is whatever the consumer stored on `EditorTab.persistedState`
 * before serialisation (or `undefined` for tabs that opted out, or for
 * saves predating the field). Treat it as opaque and JSON-parsed.
 */
export type RebuildTabCallback = (tabId: string, data?: unknown) => EditorTab | null;

/**
 * Rebuild workbench tree from persisted state
 * @param savedState The persisted state to restore
 * @param rebuildTab Callback to rebuild a tab from its ID
 * @returns The restored WorkbenchTree or null if restoration failed
 */
export function rebuildWorkbenchTree(
  savedState: PersistedWorkbenchState,
  rebuildTab: RebuildTabCallback
): WorkbenchTree | null {
  if (savedState.groups.length === 0) {
    return null;
  }

  const rebuildNode = (saved: PersistedGroupNode): GroupNode | null => {
    if (saved.type === 'tabs') {
      // TabGroupNode
      const tabs: EditorTab[] = [];
      const ids = saved.tabIds ?? [];
      const data = saved.tabData ?? [];
      for (let i = 0; i < ids.length; i++) {
        const tabId = ids[i];
        if (tabId === undefined) continue;
        const persistedState = data[i] ?? undefined;
        const tab = rebuildTab(tabId, persistedState);
        if (tab) tabs.push(tab);
      }
      if (tabs.length === 0) return null;
      
      const firstTab = tabs[0];
      let activeTabId: string;
      if (saved.activeTabId && tabs.some(t => t.id === saved.activeTabId)) {
        activeTabId = saved.activeTabId;
      } else if (firstTab) {
        activeTabId = firstTab.id;
      } else {
        return null;
      }
      return {
        id: saved.id,
        tabs,
        activeTabId
      } as TabGroupNode;
    } else {
      // ContainerGroupNode
      const children: GroupNode[] = [];
      for (const child of saved.children ?? []) {
        const rebuilt = rebuildNode(child);
        if (rebuilt) children.push(rebuilt);
      }
      if (children.length === 0) return null;
      
      return {
        id: saved.id,
        orientation: saved.orientation ?? 'vertical',
        groups: children,
        sizes: saved.sizes
      } as ContainerGroupNode;
    }
  };

  // Rebuild the workbench tree with correct hierarchical structure
  const restoredGroups: GroupNode[] = [];
  for (const savedGroup of savedState.groups) {
    const rebuilt = rebuildNode(savedGroup);
    if (rebuilt) restoredGroups.push(rebuilt);
  }

  if (restoredGroups.length === 0) {
    return null;
  }

  return {
    orientation: savedState.orientation,
    groups: restoredGroups,
    sizes: savedState.sizes
  };
}

/**
 * Get the storage key for a workbench
 */
function getStorageKey(workbenchId: string): string {
  return `workbench_state_${workbenchId}`;
}

/**
 * Save workbench state to storage
 */
export async function saveWorkbenchState(workbenchId: string, tree: WorkbenchTree): Promise<boolean> {
  if (tree.groups.length === 0) {
    return false;
  }
  const state = extractWorkbenchState(tree);
  return saveToStorage(getStorageKey(workbenchId), state);
}

/**
 * Load workbench state from storage
 */
export async function loadWorkbenchState(workbenchId: string): Promise<PersistedWorkbenchState | undefined> {
  return await loadFromStorage(getStorageKey(workbenchId)) as PersistedWorkbenchState | undefined;
}

/**
 * Peek the persisted tab IDs for a workbench WITHOUT rebuilding any tabs.
 *
 * A lightweight read for consumers that need to know up front whether a
 * mount-time restore will reopen any tabs — e.g. to decide whether to show an
 * empty/onboarding placeholder immediately or hold it back until the restore
 * has reopened the persisted tabs. Walks the persisted group tree (including
 * split containers) and returns every tab id, in document order. Returns an
 * empty array when nothing is persisted.
 */
export async function loadWorkbenchTabIds(workbenchId: string): Promise<string[]> {
  const state = await loadWorkbenchState(workbenchId);
  if (!state) return [];
  const ids: string[] = [];
  const walk = (nodes: PersistedGroupNode[]): void => {
    for (const node of nodes) {
      if (node.type === 'tabs') {
        if (node.tabIds) ids.push(...node.tabIds);
      } else if (node.children) {
        walk(node.children);
      }
    }
  };
  walk(state.groups);
  return ids;
}

/**
 * Clear workbench state from storage
 */
export async function clearWorkbenchState(workbenchId: string): Promise<boolean> {
  const api = (window as { api?: { storage?: { delete: (key: string) => Promise<boolean> } } }).api;
  if (!api?.storage) return false;
  try {
    return await api.storage.delete(getStorageKey(workbenchId));
  } catch {
    return false;
  }
}
