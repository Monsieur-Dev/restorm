import type { EditorTab } from 'electron-core-ui/renderer'
import type { Folder, HTTPRequest } from './collections'

/** Breadcrumb item for navigation */
export interface BreadcrumbItem {
  id: string
  label: string
}

/** Base extended EditorTab type for restorm */
interface BaseRestormTab extends EditorTab {
  /** String representation of the title for serialization purposes */
  titleString?: string
  /** Breadcrumb path for navigation */
  breadcrumbs?: BreadcrumbItem[]
}

/** Tab displaying a folder's configuration */
export interface FolderTab extends BaseRestormTab {
  tabType: 'folder'
  /** The folder data to display */
  folder: Folder
}

/** Tab displaying an HTTP request */
export interface HTTPRequestTab extends BaseRestormTab {
  tabType: 'http-request'
  /** The HTTP request data to display */
  request: HTTPRequest
}

/** Legacy tab type for backward compatibility */
export interface LegacyTab extends BaseRestormTab {
  tabType?: undefined
  content?: string
}

/** Union of all restorm tab types */
export type RestormEditorTab = FolderTab | HTTPRequestTab | LegacyTab

/** @deprecated Use RestormEditorTab instead */
export type restormEditorTab = RestormEditorTab

/** Type guard for FolderTab */
export function isFolderTab(tab: RestormEditorTab): tab is FolderTab {
  return tab.tabType === 'folder'
}

/** Type guard for HTTPRequestTab */
export function isHTTPRequestTab(tab: RestormEditorTab): tab is HTTPRequestTab {
  return tab.tabType === 'http-request'
}
