// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, it, expect, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SplitView } from './SplitView'
import { Pane } from './Pane'

/**
 * The pane header actions must stay legible at rest instead of being
 * hidden until hover: a button faded to zero is not discreet, it is
 * undiscoverable — nothing tells the user an action lives there, so
 * they never hover to find out.
 *
 * These tests pin that contract against the REAL stylesheet injected
 * into the document, with markup rendered by the actual component, so
 * a class rename on either side breaks them. Vitest stubs
 * `import './splitview.css'` to nothing, hence the read from disk;
 * the path is anchored to this test file, not to the cwd.
 */

const ACTIONS_SELECTOR = '.split-view-view-header-actions'

const readStylesheet = (): string => {
	const testPath = expect.getState().testPath
	if (!testPath) throw new Error('vitest did not expose the test file path')
	return readFileSync(resolve(dirname(testPath), 'splitview.css'), 'utf8')
}

/** The single rule in splitview.css whose selector satisfies `predicate`. */
const findRule = (predicate: (selector: string) => boolean): CSSStyleRule => {
	const sheet = document.styleSheets[0]
	if (!sheet) throw new Error('splitview.css was not injected into the document')
	const [rule, ...extra] = Array.from(sheet.cssRules).filter(
		(candidate): candidate is CSSStyleRule =>
			candidate instanceof CSSStyleRule && predicate(candidate.selectorText)
	)
	if (!rule || extra.length > 0) {
		throw new Error(
			`expected exactly 1 matching rule in splitview.css, found ${rule ? 1 + extra.length : 0}`
		)
	}
	return rule
}

const restRule = (): CSSStyleRule =>
	findRule(
		(selector) =>
			selector.endsWith(ACTIONS_SELECTOR) && !selector.includes(':hover')
	)

beforeAll(() => {
	// jsdom ships no ResizeObserver; SplitView observes its container on
	// mount and would throw before rendering anything. Layout never
	// changes here, so the stub only has to track registrations.
	globalThis.ResizeObserver = class {
		private readonly observed = new Set<Element>()
		observe(target: Element): void {
			this.observed.add(target)
		}
		unobserve(target: Element): void {
			this.observed.delete(target)
		}
		disconnect(): void {
			this.observed.clear()
		}
	} as unknown as typeof ResizeObserver

	const style = document.createElement('style')
	style.textContent = readStylesheet()
	document.head.appendChild(style)
})

describe('SplitView pane header actions visibility', () => {
	const renderPane = (alwaysShow?: boolean): HTMLElement => {
		const { container } = render(
			<SplitView>
				<Pane
					title="Workspace"
					{...(alwaysShow === undefined ? {} : { alwaysShowHeaderActions: alwaysShow })}
					headerActions={<button type="button">Add</button>}
				>
					<div>body</div>
				</Pane>
			</SplitView>
		)
		const actions = container.querySelector(ACTIONS_SELECTOR)
		if (!(actions instanceof HTMLElement)) {
			throw new Error('SplitView did not render a header actions cluster')
		}
		return actions
	}

	it('renders the actions at half opacity while the pane is not hovered', () => {
		expect(getComputedStyle(renderPane()).opacity).toBe('0.5')
	})

	it('leaves the resting actions clickable and in the tab order', () => {
		const computed = getComputedStyle(renderPane())
		// `pointer-events: none` would swallow the click; `visibility` or
		// `display` would drop the button out of the tab order. The idle
		// dimming has to be opacity and nothing else.
		expect(computed.pointerEvents).not.toBe('none')
		expect(computed.visibility).not.toBe('hidden')
		expect(computed.display).not.toBe('none')
		expect(restRule().style.getPropertyValue('pointer-events')).toBe('')
		expect(screen.getByRole('button', { name: 'Add' })).toBeDefined()
	})

	it('brings the actions to full opacity on pane hover', () => {
		// jsdom cannot match `:hover`, so the hover state is asserted
		// structurally against the parsed stylesheet.
		const rule = findRule(
			(selector) =>
				selector.includes(':hover') && selector.endsWith(ACTIONS_SELECTOR)
		)
		expect(rule.style.opacity).toBe('1')
		// Hover must differ from rest by opacity ALONE — anything else
		// (a translate, say) makes a permanently visible cluster jump
		// under the pointer.
		expect(rule.style.length).toBe(1)
	})

	it('brings the actions to full opacity when one of them has focus', () => {
		const rule = findRule((selector) => selector.includes(':focus-within'))
		expect(rule.style.opacity).toBe('1')
	})

	it('transitions between the two states instead of snapping', () => {
		// jsdom does not expand the `transition` shorthand into computed
		// longhands, so read the declaration off the rule.
		const transition = restRule().style.getPropertyValue('transition')
		expect(transition).toContain('opacity')
		const duration = /([\d.]+)s/.exec(transition)?.[1]
		expect(duration).toBeDefined()
		expect(parseFloat(duration ?? '0')).toBeGreaterThan(0)
	})

	it('renders the actions at full opacity with alwaysShowHeaderActions', () => {
		expect(getComputedStyle(renderPane(true)).opacity).toBe('1')
	})
})
