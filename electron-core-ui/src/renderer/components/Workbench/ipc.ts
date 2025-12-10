export async function getCursorScreenPoint(): Promise<{ x: number; y: number; display?: { x: number; y: number; width: number; height: number } }> {
  return window.api.getCursorScreenPoint()
}

export async function getActiveWindowBounds(): Promise<{ x: number; y: number; width: number; height: number }> {
  return window.api.getActiveWindowBounds()
}

export async function getCurrentWindowBounds(): Promise<{ x: number; y: number; width: number; height: number; windowId: number }> {
  return window.api.getCurrentWindowBounds()
}

export async function createAuxWindow(
  payload: { editorId: string; title: string },
  bounds: { x: number; y: number; width?: number; height?: number }
): Promise<void> {
  return window.api.createAuxWindow(payload, bounds)
}

export async function getWindowUnderCursor(): Promise<{
  windowId: number
  bounds: { x: number; y: number; width: number; height: number }
} | null> {
  return window.api.getWindowUnderCursor()
}

export async function sendWorkbenchTabToWindow(
  targetWindowId: number,
  tabData: { tabId: string; title: string; groupId: string; content?: string; cursorX?: number; cursorY?: number }
): Promise<boolean> {
  return window.api.sendWorkbenchTabToWindow(targetWindowId, tabData)
}

export function onWorkbenchTabDropped(
  callback: (tabData: { tabId: string; title: string; groupId: string; content?: string; cursorX?: number; cursorY?: number }) => void
): () => void {
  return window.api.onWorkbenchTabDropped(callback)
}


