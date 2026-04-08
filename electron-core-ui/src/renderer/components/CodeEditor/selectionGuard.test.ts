import { describe, expect, it } from 'vitest'
import { shouldRestoreMouseSelection } from './selectionGuard'

describe('shouldRestoreMouseSelection', () => {
  it('restaure la derniere selection souris saine quand un evenement keyboard collapse la selection pendant un drag', () => {
    expect(shouldRestoreMouseSelection({
      isMouseDown: true,
      source: 'keyboard',
      currentSelection: {
        anchorLine: 8,
        anchorColumn: 8,
        activeLine: 8,
        activeColumn: 8,
        isEmpty: true
      },
      lastGoodMouseSelection: {
        anchorLine: 10,
        anchorColumn: 14,
        activeLine: 9,
        activeColumn: 5,
        isEmpty: false
      }
    })).toBe(true)
  })

  it('ne restaure pas pour une vraie selection souris', () => {
    expect(shouldRestoreMouseSelection({
      isMouseDown: true,
      source: 'mouse',
      currentSelection: {
        anchorLine: 10,
        anchorColumn: 14,
        activeLine: 9,
        activeColumn: 5,
        isEmpty: false
      },
      lastGoodMouseSelection: {
        anchorLine: 10,
        anchorColumn: 14,
        activeLine: 9,
        activeColumn: 5,
        isEmpty: false
      }
    })).toBe(false)
  })

  it('ne restaure pas hors drag souris', () => {
    expect(shouldRestoreMouseSelection({
      isMouseDown: false,
      source: 'keyboard',
      currentSelection: {
        anchorLine: 8,
        anchorColumn: 8,
        activeLine: 8,
        activeColumn: 8,
        isEmpty: true
      },
      lastGoodMouseSelection: {
        anchorLine: 10,
        anchorColumn: 14,
        activeLine: 9,
        activeColumn: 5,
        isEmpty: false
      }
    })).toBe(false)
  })
})
