import type { CSSProperties, ReactNode } from 'react';

/**
 * Edge of the container the panel docks against. Drives both the
 * flex direction of the layout and the orientation of the resize
 * sash on the inside edge of the panel.
 */
export type DockSide = 'left' | 'right' | 'top' | 'bottom';

/**
 * Imperative API exposed by `Dock` via `ref`. The component does
 * NOT render its own collapse trigger — callers are expected to
 * bind their own button (in the panel header, the workbench
 * toolbar, a context menu, a keyboard shortcut, …) and call the
 * matching method here. Keeping the trigger out of the layout
 * primitive lets each call site make its own visual + a11y
 * decisions instead of inheriting one fixed gutter chevron.
 */
export interface DockHandle {
	/** Force the panel into the expanded state (no-op if already expanded). */
	expand(): void;
	/** Force the panel into the collapsed state (no-op if already collapsed). */
	collapse(): void;
	/** Flip between expanded and collapsed. */
	toggle(): void;
	/** Imperatively resize the panel. Honors `minSize` / `maxSize` / container clamp. */
	setSize(next: number): void;
}

/**
 * Props for `Dock` — a 2-pane layout with one collapsible /
 * resizable panel docked to the named edge and a main content
 * area that fills the remaining space. Dock is a layout primitive
 * only: it owns the geometry (anchor + sash + collapsed state)
 * and exposes the controls via props + imperative ref. Trigger
 * UI (buttons, menu items, shortcuts) belongs to the caller.
 */
export interface DockProps {
	/** Which edge of the container the panel anchors to. */
	side: DockSide;

	/** Content rendered inside the dockable panel. Fades to 0
	 * opacity during the collapse animation alongside the panel
	 * size. Use `panelOverlay` for trigger UI that must stay
	 * fully visible across the transition. */
	panel: ReactNode;

	/** Optional overlay rendered as an absolute child of the dock
	 * root (NOT inside the panel), so it doesn't inherit the
	 * panel's collapse-time opacity / shadow / size animations.
	 * Typical use: the caller's expand / collapse trigger button —
	 * the user must always see it, even mid-transition. The caller
	 * is responsible for positioning via inline `style` (top /
	 * right / bottom / left) since the right place depends on
	 * dock side AND on the visual context. */
	panelOverlay?: ReactNode;

	/** Main content area — fills whatever space the panel doesn't take. */
	children: ReactNode;

	/**
	 * Controlled size in px along the dock axis (width when
	 * `side` is `'left'`/`'right'`, height when `'top'`/`'bottom'`).
	 * When provided, the caller owns the value; pair with
	 * `onSizeChange` to react to user drags.
	 */
	size?: number;

	/** Initial size for uncontrolled mode. Defaults to 240 px. */
	defaultSize?: number;

	/** Fired with the next size whenever the user drags the sash. */
	onSizeChange?: (next: number) => void;

	/**
	 * Controlled collapsed state. When provided, the caller owns
	 * it; pair with `onCollapsedChange` and call the matching
	 * imperative method (or update the prop directly) to toggle.
	 */
	collapsed?: boolean;

	/** Initial collapsed state for uncontrolled mode. Defaults to `false`. */
	defaultCollapsed?: boolean;

	/**
	 * Fired with the next collapsed flag whenever
	 * `expand` / `collapse` / `toggle` is invoked, regardless of
	 * controlled vs uncontrolled. The caller can use this either
	 * to drive the controlled prop or just to react (persist,
	 * analytics, …) without owning the state.
	 */
	onCollapsedChange?: (next: boolean) => void;

	/** Minimum panel size in px when expanded. Defaults to 120 px. */
	minSize?: number;

	/**
	 * Maximum panel size in px when expanded. Defaults to whatever
	 * the container allows (clamped against the cross-axis size at
	 * drag time so the main area never disappears).
	 */
	maxSize?: number;

	/**
	 * Size of the panel when `collapsed === true`. Defaults to 0,
	 * which fully unmounts the dockable surface — pick that when
	 * the panel can be re-expanded from outside the dock (e.g. a
	 * statusbar item, a keyboard shortcut). Set to a non-zero
	 * value (typically 28–32 px) when the caller still needs a
	 * thin gutter inside the dock to host their re-expand
	 * trigger; the panel content stays mounted so the caller can
	 * conditionally render based on their controlled `collapsed`.
	 */
	collapsedSize?: number;

	/**
	 * When `true`, hovering the collapsed gutter for
	 * `previewExpandDelayMs` opens a preview of the panel that
	 * floats over the main content (no main resize, drop shadow
	 * stays). Moving the cursor out of the dock for
	 * `previewCollapseDelayMs` folds the preview back. The
	 * `collapsed` state itself is not changed — preview is a
	 * purely visual peek.
	 */
	previewOnHover?: boolean;

	/** Hover-to-preview delay in ms. Defaults to 500. */
	previewExpandDelayMs?: number;

	/** Mouse-out delay before the preview folds back in ms. Defaults to 1000. */
	previewCollapseDelayMs?: number;

	/**
	 * Optional persistence key. When set, the current size +
	 * collapsed flag are mirrored to `localStorage` under
	 * `${storageKey}.size` and `${storageKey}.collapsed`. The
	 * caller can still override via the controlled props; storage
	 * only seeds the uncontrolled defaults and persists later
	 * changes when not controlled.
	 */
	storageKey?: string;

	/** Optional className on the root flex container. */
	className?: string;

	/** Optional inline style on the root flex container. */
	style?: CSSProperties;

	/** Optional test id stamped on the root container. */
	'data-testid'?: string;
}
