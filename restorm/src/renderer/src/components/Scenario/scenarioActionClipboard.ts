import type { ScenarioNode, ScenarioEdge } from '../../../../shared/types/collections'

/**
 * App-internal clipboard for scenario actions. It lives at module scope so a
 * group of boxes (and the edges between them) copied from one scenario can be
 * pasted into ANOTHER scenario tab — the OS clipboard isn't involved. Content
 * is deep-copied on both set and get, so neither the source graph nor a paste
 * mutates the buffer.
 */
interface ClipboardContent {
  nodes: ScenarioNode[]
  edges: ScenarioEdge[]
}

interface Point {
  x: number
  y: number
}
interface ViewportLike {
  x: number
  y: number
  zoom: number
}

let buffer: ClipboardContent | null = null

// Paste-placement state (the rule the user asked for): repeated pastes WITHOUT
// panning stack diagonally (each +40), so copies never land exactly on top of
// each other; pasting after a pan (or into another scenario) re-centres the
// group on the current view instead of dropping it off-screen.
//  - `copyCenter`  : centre of the copied group, in flow coords, captured at copy.
//  - `anchorPan`   : the viewport at the moment that decided the current target.
//  - `targetCenter`: where the group's centre lands (copyCenter while the view
//                    is unchanged, else the current view centre).
//  - `pasteCount`  : how many times we've pasted onto the same anchor (the *40).
let copyCenter: Point = { x: 0, y: 0 }
let anchorPan: ViewportLike | null = null
let targetCenter: Point = { x: 0, y: 0 }
let pasteCount = 0

const PASTE_STEP = 40

function samePan(a: ViewportLike | null, b: ViewportLike | null): boolean {
  if (!a || !b) return false
  return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.zoom - b.zoom) < 0.001
}

export function setScenarioClipboard(
  nodes: ScenarioNode[],
  edges: ScenarioEdge[],
  center: Point,
  pan: ViewportLike
): void {
  buffer = JSON.parse(JSON.stringify({ nodes, edges })) as ClipboardContent
  copyCenter = { x: center.x, y: center.y }
  anchorPan = { ...pan }
  targetCenter = { x: center.x, y: center.y }
  pasteCount = 0
}

export function getScenarioClipboard(): ClipboardContent | null {
  return buffer ? (JSON.parse(JSON.stringify(buffer)) as ClipboardContent) : null
}

export function hasScenarioClipboard(): boolean {
  return buffer !== null && buffer.nodes.length > 0
}

/**
 * Advance the paste counter for the current view and return the delta to add to
 * every copied node's stored position. If the viewport is unchanged since the
 * last placement, bump the diagonal offset; otherwise reset and re-centre on the
 * given view centre. The size of the group cancels out — the delta alone places
 * the group correctly because the copied positions already encode their layout.
 */
export function nextPasteDelta(currentPan: ViewportLike, viewCenter: Point): Point {
  if (samePan(currentPan, anchorPan)) {
    pasteCount += 1
  } else {
    pasteCount = 0
    anchorPan = { ...currentPan }
    targetCenter = { x: viewCenter.x, y: viewCenter.y }
  }
  return {
    x: targetCenter.x + pasteCount * PASTE_STEP - copyCenter.x,
    y: targetCenter.y + pasteCount * PASTE_STEP - copyCenter.y
  }
}
