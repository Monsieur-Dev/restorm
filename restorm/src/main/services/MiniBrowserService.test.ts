import { describe, it, expect, beforeEach, vi } from 'vitest'

// The service only ever touches `WebContentsView`/`BrowserWindow`
// through a tiny surface (setVisible / setBounds / addChildView /
// webContents.on). We mock `electron` to a no-op `WebContentsView`
// class (the service `new`s it) and stub the logger.
vi.mock('electron', () => ({
	// Marker class only — the service `instanceof`-checks nothing, it just
	// holds a reference. A function value satisfies the `new`-able shape
	// without tripping the empty-class lint rule.
	BrowserWindow: function BrowserWindow(): void { /* marker */ },
	WebContentsView: function WebContentsView(this: Record<string, unknown>): void {
		this.setBackgroundColor = vi.fn()
		this.setVisible = vi.fn()
		this.setBounds = vi.fn()
		this.webContents = {
			loadURL: vi.fn().mockResolvedValue(undefined),
			getURL: vi.fn().mockReturnValue(''),
			on: vi.fn(),
			close: vi.fn(),
			isDestroyed: vi.fn().mockReturnValue(false),
			navigationHistory: { canGoBack: () => false, canGoForward: () => false }
		}
	}
}))

vi.mock('electron-core-ui/main', () => ({
	logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }
}))

import { miniBrowserService } from './MiniBrowserService'

/** Minimal stand-in for a `BrowserWindow` whose `webContents` lets a
 * test capture and fire the `did-start-navigation` listener the
 * service wires. */
interface NavDetails { isMainFrame: boolean; isSameDocument: boolean }
type NavListener = (details: NavDetails) => void
const makeWindow = (): {
	win: unknown
	addChildView: ReturnType<typeof vi.fn>
	fireNav: (details: NavDetails) => void
} => {
	let navListener: NavListener | null = null
	const addChildView = vi.fn()
	const win = {
		contentView: { addChildView, removeChildView: vi.fn() },
		webContents: {
			on: (event: string, listener: NavListener): void => {
				if (event === 'did-start-navigation') navListener = listener
			},
			once: vi.fn(),
			isDestroyed: () => false
		},
		isDestroyed: () => false
	}
	return {
		win,
		addChildView,
		fireNav: (details) => navListener?.(details)
	}
}

// The view a `create()` call attaches is the argument handed to
// `addChildView`; pull it back out so the test can assert on its mock
// methods.
interface MockView {
	setVisible: ReturnType<typeof vi.fn>
	setBounds: ReturnType<typeof vi.fn>
}
const viewFor = (addChildView: ReturnType<typeof vi.fn>): MockView =>
	addChildView.mock.calls[0][0] as MockView

describe('MiniBrowserService — visibility', () => {
	let tabSeq = 0
	const nextTab = (): string => `tab-${++tabSeq}`

	beforeEach(() => {
		tabSeq = 0
	})

	it('starts a freshly created view hidden until positioned', () => {
		const { win, addChildView } = makeWindow()
		const tabId = nextTab()
		miniBrowserService.create(tabId, win as never)
		const view = viewFor(addChildView)
		expect(view.setVisible).toHaveBeenLastCalledWith(false)
		miniBrowserService.destroy(tabId)
	})

	it('shows the view on a non-zero rect and hides it on a zero rect', () => {
		const { win, addChildView } = makeWindow()
		const tabId = nextTab()
		miniBrowserService.create(tabId, win as never)
		const view = viewFor(addChildView)

		miniBrowserService.setBounds(tabId, { x: 10, y: 10, width: 200, height: 100 })
		expect(view.setVisible).toHaveBeenLastCalledWith(true)
		expect(view.setBounds).toHaveBeenCalledWith({ x: 10, y: 10, width: 200, height: 100 })

		miniBrowserService.setBounds(tabId, { x: 0, y: 0, width: 0, height: 0 })
		expect(view.setVisible).toHaveBeenLastCalledWith(false)
		miniBrowserService.destroy(tabId)
	})

	it('re-shows after a renderer refresh when the same rect is re-pushed', () => {
		const { win, addChildView, fireNav } = makeWindow()
		const tabId = nextTab()
		miniBrowserService.create(tabId, win as never)
		const view = viewFor(addChildView)

		const rect = { x: 5, y: 5, width: 300, height: 150 }
		miniBrowserService.setBounds(tabId, rect)
		expect(view.setVisible).toHaveBeenLastCalledWith(true)

		// Renderer reload: top-frame, full-document navigation hides it.
		fireNav({ isMainFrame: true, isSameDocument: false })
		expect(view.setVisible).toHaveBeenLastCalledWith(false)

		// Remounted renderer re-pushes the SAME rect — visibility must be
		// reconciled even though the bounds are unchanged (dedup'd).
		miniBrowserService.setBounds(tabId, rect)
		expect(view.setVisible).toHaveBeenLastCalledWith(true)
		miniBrowserService.destroy(tabId)
	})

	it('ignores sub-frame and same-document navigations', () => {
		const { win, addChildView, fireNav } = makeWindow()
		const tabId = nextTab()
		miniBrowserService.create(tabId, win as never)
		const view = viewFor(addChildView)
		miniBrowserService.setBounds(tabId, { x: 1, y: 1, width: 100, height: 100 })
		expect(view.setVisible).toHaveBeenLastCalledWith(true)

		fireNav({ isMainFrame: false, isSameDocument: false }) // sub-frame
		fireNav({ isMainFrame: true, isSameDocument: true })   // hash / pushState
		expect(view.setVisible).toHaveBeenLastCalledWith(true) // still shown
		miniBrowserService.destroy(tabId)
	})
})
