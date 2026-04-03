import React from 'react'
import type { Folder } from '../../../../shared/types/collections'
import { BaseFolderView } from './BaseFolderView'

export interface FolderViewProps {
  /** The folder to display */
  folder: Folder
  /** Called when folder data changes */
  onFolderChange?: (folder: Folder) => void
}

/**
 * View for displaying a standard Folder (docs + notes only).
 */
export const FolderView: React.FC<FolderViewProps> = ({ folder, onFolderChange }) => {
  // Suppress unused warning - kept for API compatibility
  void onFolderChange

  return <BaseFolderView folder={folder} />
}

export default FolderView
