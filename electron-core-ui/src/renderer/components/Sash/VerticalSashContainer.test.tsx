// @vitest-environment jsdom
/**
 * `VerticalSashContainer` sizing across container resizes: by default the
 * left panel keeps its pixel width; with `keepRatio` it keeps its SHARE of
 * the container — the share it was seeded with, or the one the user last
 * dragged to — within the min widths. jsdom has no layout, so the container
 * width is driven by a controllable ResizeObserver stub + a `clientWidth`
 * getter, and the result is read from the `data-left-width` attribute.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { VerticalSashContainer } from './VerticalSashContainer'

type Callback = () => void
const observers: Callback[] = []
let containerWidth = 1000

beforeEach(() => {
	observers.length = 0
	containerWidth = 1000
	;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
		constructor(cb: Callback) { observers.push(cb) }
		observe(): void { /* no-op */ }
		unobserve(): void { /* no-op */ }
		disconnect(): void { /* no-op */ }
	}
	Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => containerWidth })
})

afterEach(() => {
	delete (HTMLElement.prototype as { clientWidth?: unknown }).clientWidth
})

function resizeTo(width: number): void {
	containerWidth = width
	act(() => { for (const cb of observers) cb() })
}

function leftWidth(root: HTMLElement): number {
	return Number(root.getAttribute('data-left-width'))
}

describe('VerticalSashContainer — container resizes', () => {
	it('keeps the absolute left width by default', () => {
		const { getByTestId } = render(<VerticalSashContainer data-testid="vs" initialLeftRatio={0.5} minLeftWidth={100} minRightWidth={100} Left={<div />} Right={<div />} />)
		resizeTo(1000)
		expect(leftWidth(getByTestId('vs'))).toBe(500)
		resizeTo(600)
		expect(leftWidth(getByTestId('vs'))).toBe(500)
	})

	it('keeps the split proportional with keepRatio, within the min widths', () => {
		const { getByTestId } = render(<VerticalSashContainer data-testid="vs" keepRatio initialLeftRatio={0.5} minLeftWidth={100} minRightWidth={240} Left={<div />} Right={<div />} />)
		resizeTo(1000)
		expect(leftWidth(getByTestId('vs'))).toBe(500)
		resizeTo(600)
		expect(leftWidth(getByTestId('vs'))).toBe(300)
		// Too narrow for 50/50 without starving the right panel: the right min wins…
		resizeTo(400)
		expect(leftWidth(getByTestId('vs'))).toBe(160)
		// …and the remembered share is intact once there is room again.
		resizeTo(1200)
		expect(leftWidth(getByTestId('vs'))).toBe(600)
	})
})
