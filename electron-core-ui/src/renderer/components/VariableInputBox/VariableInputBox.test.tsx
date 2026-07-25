// @vitest-environment jsdom
/**
 * Regression test: an open Monaco {{...}} suggest/hover widget must be
 * explicitly hidden when this input loses visibility — e.g. a workbench
 * tab switching away only toggles `display:none` on the tab's slot, it
 * never unmounts the editor, so a widget reparented onto `document.body`
 * (via `fixedOverflowWidgets`/`overflowWidgetsDomNode`, see
 * `VariableInputBox.tsx`) would otherwise keep floating over whatever
 * tab/request is now active.
 *
 * `CodeEditor` (and therefore Monaco itself) is mocked out — Monaco does
 * not render in jsdom. This file exercises only VariableInputBox's own
 * wiring: the `IntersectionObserver` on the container and the
 * `onDidBlurEditorWidget` fallback, both driving a fake editor whose
 * `trigger`/`getContribution` calls we can assert on directly.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { VariableInputBox } from './VariableInputBox'

const { fakeEditor, fakeMonacoInstance, hideContentHover, fireBlur } = vi.hoisted(() => {
	let blurHandler: (() => void) | undefined
	const hideContentHoverFn = vi.fn()
	const contribution = { hideContentHover: hideContentHoverFn, dispose: vi.fn() }
	const editor = {
		trigger: vi.fn(),
		getContribution: vi.fn((id: string) => (id === 'editor.contrib.contentHover' ? contribution : null)),
		getModel: vi.fn(() => null),
		onDidBlurEditorWidget: vi.fn((cb: () => void) => {
			blurHandler = cb
			return { dispose: vi.fn() }
		}),
		onKeyDown: vi.fn(() => ({ dispose: vi.fn() })),
		onDidPaste: vi.fn(() => ({ dispose: vi.fn() })),
		addCommand: vi.fn(),
		getDomNode: vi.fn(() => null),
		updateOptions: vi.fn()
	}
	const monacoInstance = {
		KeyCode: { Enter: 3, F3: 59 },
		KeyMod: { CtrlCmd: 2048, Shift: 1024 },
		languages: {
			setMonarchTokensProvider: vi.fn(),
			registerCompletionItemProvider: vi.fn(() => ({ dispose: vi.fn() })),
			registerHoverProvider: vi.fn(() => ({ dispose: vi.fn() }))
		}
	}
	return {
		fakeEditor: editor,
		fakeMonacoInstance: monacoInstance,
		hideContentHover: hideContentHoverFn,
		fireBlur: () => blurHandler?.()
	}
})

// `CodeEditor` normally mounts `@monaco-editor/react`'s `Editor`, which
// doesn't render in jsdom. Stand in for it with a stub that immediately
// calls `onMount` with a fake editor/monaco pair, mirroring what a real
// mount does — VariableInputBox's `handleMount` runs unmodified against it.
vi.mock('../CodeEditor/CodeEditor', () => ({
	CodeEditor: ({
		onMount
	}: {
		onMount?: (editor: typeof fakeEditor, monaco: typeof fakeMonacoInstance) => void
	}) => {
		React.useEffect(() => {
			onMount?.(fakeEditor, fakeMonacoInstance)
		}, [onMount])
		return <div data-testid="fake-code-editor" />
	}
}))

interface IOEntry { isIntersecting: boolean }
type IOCallback = (entries: IOEntry[]) => void
class FakeIntersectionObserver {
	callback: IOCallback
	observe = vi.fn()
	disconnect = vi.fn()
	unobserve = vi.fn()
	constructor(callback: IOCallback) {
		this.callback = callback
		ioInstances.push(this)
	}
}
let ioInstances: FakeIntersectionObserver[] = []

beforeEach(() => {
	ioInstances = []
	;(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeIntersectionObserver
})

afterEach(() => {
	vi.clearAllMocks()
})

describe('VariableInputBox — suggest/hover widget hidden on visibility loss', () => {
	it('hides the suggest + hover widgets when the container stops intersecting the viewport', () => {
		render(<VariableInputBox value="" onChange={() => { /* no-op */ }} variables={[]} disableDefaultProviders />)

		expect(ioInstances).toHaveLength(1)

		act(() => {
			ioInstances[0]?.callback([{ isIntersecting: false }])
		})

		expect(fakeEditor.trigger).toHaveBeenCalledWith(expect.any(String), 'hideSuggestWidget', {})
		expect(hideContentHover).toHaveBeenCalledTimes(1)
	})

	it('does not hide the widgets while the container stays visible (non-regression)', () => {
		render(<VariableInputBox value="" onChange={() => { /* no-op */ }} variables={[]} disableDefaultProviders />)

		act(() => {
			ioInstances[0]?.callback([{ isIntersecting: true }])
		})

		expect(fakeEditor.trigger).not.toHaveBeenCalled()
		expect(hideContentHover).not.toHaveBeenCalled()
	})

	it('hides the widgets on editor widget blur (direct click away, no tab switch)', () => {
		render(<VariableInputBox value="" onChange={() => { /* no-op */ }} variables={[]} disableDefaultProviders />)

		act(() => {
			fireBlur()
		})

		expect(fakeEditor.trigger).toHaveBeenCalledWith(expect.any(String), 'hideSuggestWidget', {})
		expect(hideContentHover).toHaveBeenCalledTimes(1)
	})

	it('disconnects the observer on unmount', () => {
		const { unmount } = render(
			<VariableInputBox value="" onChange={() => { /* no-op */ }} variables={[]} disableDefaultProviders />
		)

		const observer = ioInstances[0]
		expect(observer?.disconnect).not.toHaveBeenCalled()

		unmount()

		expect(observer?.disconnect).toHaveBeenCalledTimes(1)
	})
})
