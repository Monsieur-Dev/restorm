// @vitest-environment jsdom
/**
 * Regression test for the vertical/horizontal-sash cross-axis footgun: the
 * Sash root used to unconditionally set an inline `height: 'auto'` (vertical)
 * / `width: 'auto'` (horizontal) style. Inline styles beat sash.css's
 * `.sash.vertical { height: 100% }` / `.sash.horizontal { width: 100% }`
 * fallback, and `layout()` only writes a concrete pixel value on the cross
 * axis when the consumer's layoutProvider supplies the *optional*
 * `getVerticalSashHeight` / `getHorizontalSashWidth` hook — so a consumer
 * that omits it got a present-but-0px, unhittable sash with no error.
 *
 * These tests pin the fix at the mechanism level (the inline style actually
 * written to the DOM node), since jsdom has no layout engine and can't
 * resolve a percentage-based CSS height/width to confirm "non-zero pixels"
 * directly.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { render } from '@testing-library/react'
import { Sash } from './Sash'
import type { IVerticalSashLayoutProvider, IHorizontalSashLayoutProvider } from './types'

beforeAll(() => {
	if (!('ResizeObserver' in globalThis)) {
		;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
			observe(): void { /* no-op */ }
			unobserve(): void { /* no-op */ }
			disconnect(): void { /* no-op */ }
		}
	}
})

describe('Sash — cross-axis sizing', () => {
	it('does not inline a height on a vertical sash whose layoutProvider omits getVerticalSashHeight, letting sash.css win', () => {
		const layoutProvider: IVerticalSashLayoutProvider = {
			getVerticalSashLeft: () => 100
		}
		const { getByTestId } = render(
			<Sash orientation="vertical" layoutProvider={layoutProvider} data-testid="sash" />
		)
		const el = getByTestId('sash')
		expect(el.style.height).toBe('')
		// The fixed axis (width) is still driven by the `size` prop.
		expect(el.style.width).toBe('4px')
	})

	it('still lets a concrete getVerticalSashHeight win over the CSS fallback', () => {
		const layoutProvider: IVerticalSashLayoutProvider = {
			getVerticalSashLeft: () => 100,
			getVerticalSashHeight: () => 321
		}
		const { getByTestId } = render(
			<Sash orientation="vertical" layoutProvider={layoutProvider} data-testid="sash" />
		)
		const el = getByTestId('sash')
		expect(el.style.height).toBe('321px')
	})

	it('does not inline a width on a horizontal sash whose layoutProvider omits getHorizontalSashWidth, letting sash.css win', () => {
		const layoutProvider: IHorizontalSashLayoutProvider = {
			getHorizontalSashTop: () => 100
		}
		const { getByTestId } = render(
			<Sash orientation="horizontal" layoutProvider={layoutProvider} data-testid="sash" />
		)
		const el = getByTestId('sash')
		expect(el.style.width).toBe('')
		expect(el.style.height).toBe('4px')
	})

	it('still lets a concrete getHorizontalSashWidth win over the CSS fallback', () => {
		const layoutProvider: IHorizontalSashLayoutProvider = {
			getHorizontalSashTop: () => 100,
			getHorizontalSashWidth: () => 654
		}
		const { getByTestId } = render(
			<Sash orientation="horizontal" layoutProvider={layoutProvider} data-testid="sash" />
		)
		const el = getByTestId('sash')
		expect(el.style.width).toBe('654px')
	})
})
