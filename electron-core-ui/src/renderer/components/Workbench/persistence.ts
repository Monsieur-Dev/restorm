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
      return {
        type: 'tabs',
        id: node.id,
        tabIds: node.tabs.map(t => t.id),
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
 * Callback to rebuild a tab from its ID
 * Returns the EditorTab or null if not found
 */
export type RebuildTabCallback = (tabId: string) => EditorTab | null;

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
      for (const tabId of saved.tabIds ?? []) {
        const tab = rebuildTab(tabId);
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
  return loadFromStorage<PersistedWorkbenchState>(getStorageKey(workbenchId));
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
