import { describe, it, expect } from 'vitest'
import { nextPageScrollPosition, shouldStopTrackAutoScroll, trackClickDirection } from './trackAutoScroll'

describe('nextPageScrollPosition', () => {
	it('jumps one viewport down when direction is +1', () => {
		expect(nextPageScrollPosition(0, 400, 2_000, 1)).toBe(400)
		expect(nextPageScrollPosition(400, 400, 2_000, 1)).toBe(800)
	})

	it('jumps one viewport up when direction is -1', () => {
		expect(nextPageScrollPosition(800, 400, 2_000, -1)).toBe(400)
		expect(nextPageScrollPosition(400, 400, 2_000, -1)).toBe(0)
	})

	it('clamps to 0 when scrolling past the top', () => {
		expect(nextPageScrollPosition(100, 400, 2_000, -1)).toBe(0)
		expect(nextPageScrollPosition(0, 400, 2_000, -1)).toBe(0)
	})

	it('clamps to max when scrolling past the bottom', () => {
		expect(nextPageScrollPosition(1_500, 400, 2_000, 1)).toBe(1_600)
		expect(nextPageScrollPosition(1_600, 400, 2_000, 1)).toBe(1_600)
	})

	it('returns 0 when content fits in the viewport', () => {
		expect(nextPageScrollPosition(0, 400, 200, 1)).toBe(0)
	})
})

describe('shouldStopTrackAutoScroll', () => {
	it('stops scrolling up once the thumb top has reached the cursor', () => {
		expect(shouldStopTrackAutoScroll(80, 120, 60, -1)).toBe(false) // thumb still below cursor
		expect(shouldStopTrackAutoScroll(60, 100, 60, -1)).toBe(true)  // thumb at cursor
		expect(shouldStopTrackAutoScroll(40, 80, 60, -1)).toBe(true)   // thumb past cursor
	})

	it('stops scrolling down once the thumb bottom has reached the cursor', () => {
		expect(shouldStopTrackAutoScroll(20, 60, 80, 1)).toBe(false)  // thumb still above cursor
		expect(shouldStopTrackAutoScroll(40, 80, 80, 1)).toBe(true)   // thumb at cursor
		expect(shouldStopTrackAutoScroll(60, 100, 80, 1)).toBe(true)  // thumb past cursor
	})
})

describe('trackClickDirection', () => {
	it('returns -1 when the cursor is above the thumb', () => {
		expect(trackClickDirection(20, 80, 120)).toBe(-1)
	})

	it('returns +1 when the cursor is below the thumb', () => {
		expect(trackClickDirection(160, 80, 120)).toBe(1)
	})

	it('returns null when the cursor is on the thumb itself', () => {
		expect(trackClickDirection(100, 80, 120)).toBeNull()
		expect(trackClickDirection(80, 80, 120)).toBeNull()
		expect(trackClickDirection(120, 80, 120)).toBeNull()
	})
})
