import React, {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState
} from 'react';
import { Sash } from '../../Sash';
import type {
	IHorizontalSashLayoutProvider,
	IVerticalSashLayoutProvider,
	SashEvent
} from '../../Sash';
import type { DockHandle, DockProps, DockSide } from './types';
import './dock.css';

const DEFAULT_SIZE = 240;
const DEFAULT_MIN_SIZE = 120;
const DEFAULT_COLLAPSED_SIZE = 0;
/**
 * Cross-axis breathing room kept reserved for the main area when
 * computing the maximum panel size during a drag. Without this the
 * user could drag the sash all the way across the container and
 * make the main content disappear.
 */
const MAIN_AREA_RESERVE = 80;
/**
 * Collapse / expand transitions overshoot by this many pixels along
 * the dock axis before settling — the panel briefly grows past its
 * resting size, giving the motion a small "pulse" before snapping
 * to its final width / height. Mirrored on both directions so the
 * gesture reads symmetrically.
 */
const OVERSHOOT_PX = 50;
/** Phase 1 — current size → `size + OVERSHOOT_PX`. */
const OVERSHOOT_DURATION_MS = 240;
/** Phase 2 — overshoot → target (also drives the opacity + shadow
 * transitions, so all three finish together). */
const SETTLE_DURATION_MS = 320;
const TOTAL_DURATION_MS = OVERSHOOT_DURATION_MS + SETTLE_DURATION_MS;
const DEFAULT_PREVIEW_EXPAND_MS = 1000;
const DEFAULT_PREVIEW_COLLAPSE_MS = 1000;

function isVertical(side: DockSide): boolean {
	return side === 'left' || side === 'right';
}

function readPersisted(storageKey: string | undefined, suffix: string): string | null {
	if (storageKey === undefined) return null;
	try {
		return window.localStorage.getItem(`${storageKey}.${suffix}`);
	} catch {
		return null;
	}
}

function writePersisted(storageKey: string | undefined, suffix: string, value: string): void {
	if (storageKey === undefined) return;
	try {
		window.localStorage.setItem(`${storageKey}.${suffix}`, value);
	} catch {
		/* no-op */
	}
}

/**
 * `Dock` — edge-anchored, collapsible, resizable 2-pane layout
 * primitive. The dockable panel sits against one of the four
 * container edges (left / right / top / bottom); a `Sash` on the
 * inside edge of the panel handles drag-to-resize; controlled +
 * uncontrolled state are both supported. The component does NOT
 * render its own collapse trigger — callers expose their own
 * (typically a chevron in the panel header or a workbench
 * toolbar button) and drive `Dock` either through the controlled
 * `collapsed` prop or via the imperative `expand` / `collapse` /
 * `toggle` methods on its ref.
 *
 * Layout invariants:
 *
 * - Expanded: `[panel @ size px] [sash 4 px] [main fills the rest]`
 * - Collapsed: `[gutter @ collapsedSize px] [main fills the rest]` —
 *   the sash is unmounted so the user can't drag a hidden panel.
 * - For `side: 'right'` / `'bottom'` the flex direction is reversed
 *   so the panel lands at the trailing edge while the children render
 *   in document order (no need for the caller to rearrange JSX).
 */
export const Dock = forwardRef<DockHandle, DockProps>(function Dock(props, ref) {
	const {
		side,
		panel,
		panelOverlay,
		children,
		size: controlledSize,
		defaultSize = DEFAULT_SIZE,
		onSizeChange,
		collapsed: controlledCollapsed,
		defaultCollapsed = false,
		onCollapsedChange,
		minSize = DEFAULT_MIN_SIZE,
		maxSize,
		collapsedSize = DEFAULT_COLLAPSED_SIZE,
		previewOnHover = false,
		previewExpandDelayMs = DEFAULT_PREVIEW_EXPAND_MS,
		previewCollapseDelayMs = DEFAULT_PREVIEW_COLLAPSE_MS,
		storageKey,
		className,
		style,
		'data-testid': dataTestId
	} = props;

	const vertical = isVertical(side);
	const isControlledSize = controlledSize !== undefined;
	const isControlledCollapsed = controlledCollapsed !== undefined;

	const [internalSize, setInternalSize] = useState<number>(() => {
		const persisted = readPersisted(storageKey, 'size');
		if (persisted !== null) {
			const parsed = Number.parseInt(persisted, 10);
			if (Number.isFinite(parsed) && parsed >= minSize) return parsed;
		}
		return defaultSize;
	});
	const [internalCollapsed, setInternalCollapsed] = useState<boolean>(() => {
		const persisted = readPersisted(storageKey, 'collapsed');
		if (persisted === 'true') return true;
		if (persisted === 'false') return false;
		return defaultCollapsed;
	});

	const size = isControlledSize ? controlledSize : internalSize;
	const collapsed = isControlledCollapsed ? controlledCollapsed : internalCollapsed;

	// Debounce the `size` write — without it every drag pixel hits
	// `localStorage.setItem` (sync, blocks the main thread). 200 ms
	// of inactivity is short enough that a quick drag-and-release
	// still persists, long enough that a continuous drag only
	// writes once at the end.
	useEffect(() => {
		if (storageKey === undefined) return;
		const handle = window.setTimeout(() => { writePersisted(storageKey, 'size', String(size)); }, 200);
		return () => { clearTimeout(handle); };
	}, [storageKey, size]);

	useEffect(() => { writePersisted(storageKey, 'collapsed', String(collapsed)); }, [storageKey, collapsed]);

	const containerRef = useRef<HTMLDivElement>(null);
	const [containerCrossAxis, setContainerCrossAxis] = useState<number>(0);
	const sashStartSizeRef = useRef<number>(size);

	// Animation state. `renderSize` is the size we actually paint —
	// it diverges from `size` during a collapse / expand transition
	// (overshoots by `OVERSHOOT_PX` for `OVERSHOOT_DURATION_MS`
	// before settling). `renderPanel` keeps the panel mounted
	// during the animation even when `collapsedSize === 0`, so the
	// CSS transitions on width / height / opacity / box-shadow have
	// somewhere to play. `dragging` flips during sash drags so the
	// width transition pauses — without it the per-frame size
	// changes would compound into visible lag.
	const [renderSize, setRenderSize] = useState<number>(collapsed ? collapsedSize : size);
	const [renderPanel, setRenderPanel] = useState<boolean>(!collapsed || collapsedSize > 0);
	const [dragging, setDragging] = useState<boolean>(false);
	// Three-phase preview state machine. `idle` = no overlay; `visible`
	// = the floating content is fully expanded (mouse is over the
	// gutter or panel); `closing` = mouse has left and the overlay is
	// shrinking back. Keeping `closing` as its own phase is what lets
	// us run the fold-in animation while `.dock--preview` is still on
	// the dock root (so `.dock__panel-content` stays absolutely
	// positioned the whole time). Without it, `dock--preview` would
	// flip off the moment we leave `visible`, the content would drop
	// back into the flex flow at `100%`-of-`collapsedSize` width, and
	// the main column would jump by `collapsedSize` px at the start
	// of the fold-back — the very bug this state machine fixes.
	type PreviewMode = 'idle' | 'visible' | 'closing';
	const [previewMode, setPreviewMode] = useState<PreviewMode>('idle');
	const previewModeRef = useRef<PreviewMode>('idle');
	const previewExpandTimerRef = useRef<number | null>(null);
	const previewCollapseTimerRef = useRef<number | null>(null);
	const prevCollapsedRef = useRef<boolean>(collapsed);

	useEffect(() => { previewModeRef.current = previewMode; }, [previewMode]);

	const clearPreviewTimers = useCallback(() => {
		if (previewExpandTimerRef.current !== null) {
			clearTimeout(previewExpandTimerRef.current);
			previewExpandTimerRef.current = null;
		}
		if (previewCollapseTimerRef.current !== null) {
			clearTimeout(previewCollapseTimerRef.current);
			previewCollapseTimerRef.current = null;
		}
	}, []);

	useEffect(() => () => { clearPreviewTimers(); }, [clearPreviewTimers]);

	// While in the `closing` phase the content is shrinking back to
	// `collapsedSize`. At the end of the animation window we drop the
	// `.dock--preview` class (`previewMode === 'idle'`) — the content
	// flips from absolute back to in-flow, but at the SAME width and
	// position as the in-flow steady state, so the swap is visually
	// invisible (no main column shift).
	useEffect(() => {
		if (previewMode !== 'closing') return;
		const t = window.setTimeout(() => { setPreviewMode('idle'); }, TOTAL_DURATION_MS);
		return () => { clearTimeout(t); };
	}, [previewMode]);

	// When the user really expands the dock (collapsed flips to
	// false), any in-flight hover preview is moot — drop it and
	// cancel the pending timers. Defer the setState through an RAF
	// to keep `react-hooks/set-state-in-effect` happy without
	// disabling the rule.
	useEffect(() => {
		if (collapsed || previewMode === 'idle') return;
		clearPreviewTimers();
		const raf = requestAnimationFrame(() => { setPreviewMode('idle'); });
		return () => { cancelAnimationFrame(raf); };
	}, [collapsed, previewMode, clearPreviewTimers]);

	const handleMouseEnter = useCallback(() => {
		if (!previewOnHover || !collapsed) return;
		clearPreviewTimers();
		previewExpandTimerRef.current = window.setTimeout(() => {
			previewExpandTimerRef.current = null;
			setPreviewMode('visible');
		}, previewExpandDelayMs);
	}, [previewOnHover, collapsed, previewExpandDelayMs, clearPreviewTimers]);

	const handleMouseLeave = useCallback(() => {
		if (!previewOnHover) return;
		clearPreviewTimers();
		previewCollapseTimerRef.current = window.setTimeout(() => {
			previewCollapseTimerRef.current = null;
			// If the user left before the expand timer ever fired, jump
			// straight to `idle` (no fold-back to animate). Otherwise
			// stage the closing animation: width / opacity / shadow on
			// `.dock__panel-content` ride back to their collapsed values
			// over `TOTAL_DURATION_MS`, and the closing→idle effect
			// above drops `.dock--preview` once it's done.
			setPreviewMode(previewModeRef.current === 'visible' ? 'closing' : 'idle');
		}, previewCollapseDelayMs);
	}, [previewOnHover, previewCollapseDelayMs, clearPreviewTimers]);

	// Drive the staged size animation when `collapsed` flips.
	// Split from the size-sync effect below so a sash drag (which
	// fires `size` updates on every pixel) doesn't churn through
	// the overshoot scheduling — without the split, every drag
	// pixel scheduled + cancelled an RAF + setTimeout chain.
	useEffect(() => {
		const wasCollapsed = prevCollapsedRef.current;
		if (wasCollapsed === collapsed) return;
		prevCollapsedRef.current = collapsed;

		// Phase 1 — overshoot. Symmetric on both directions: grow
		// past the current expanded `size` by `OVERSHOOT_PX`, then
		// settle to the final target. Keep the panel mounted for
		// both phases so the CSS transitions have a destination to
		// interpolate to. The RAF defer keeps the synchronous
		// state mutation out of the effect body (satisfies
		// `react-hooks/set-state-in-effect` cleanly).
		const overshootRaf = requestAnimationFrame(() => {
			setRenderPanel(true);
			setRenderSize(size + OVERSHOOT_PX);
		});

		const settleTimer = window.setTimeout(() => {
			setRenderSize(collapsed ? collapsedSize : size);
		}, OVERSHOOT_DURATION_MS);

		// When `collapsedSize === 0`, unmount the panel after the
		// animation finishes — keeps the gutter perfectly empty
		// for the "console-bottom" / "external trigger" use cases.
		let unmountTimer: number | undefined;
		if (collapsed && collapsedSize === 0) {
			unmountTimer = window.setTimeout(() => { setRenderPanel(false); }, TOTAL_DURATION_MS);
		}

		return () => {
			cancelAnimationFrame(overshootRaf);
			clearTimeout(settleTimer);
			if (unmountTimer !== undefined) clearTimeout(unmountTimer);
		};
	}, [collapsed, size, collapsedSize]);

	// Pure size sync — runs on every `size` / `collapsedSize`
	// change but is a no-op while a collapse animation is in
	// flight (the animation effect above owns `renderSize` during
	// that window). RAF defer keeps the rule happy.
	useEffect(() => {
		if (prevCollapsedRef.current !== collapsed) return;
		const sync = requestAnimationFrame(() => {
			setRenderSize(collapsed ? collapsedSize : size);
		});
		return () => { cancelAnimationFrame(sync); };
	}, [size, collapsedSize, collapsed]);

	useEffect(() => {
		const node = containerRef.current;
		if (!node) return;
		const observer = new ResizeObserver(() => {
			const rect = node.getBoundingClientRect();
			setContainerCrossAxis(vertical ? rect.width : rect.height);
		});
		observer.observe(node);
		// `observe()` fires on the next animation frame, so the
		// observer callback alone primes `containerCrossAxis`. No
		// synchronous setState here — keeps `react-hooks/
		// set-state-in-effect` happy without disabling the rule.
		return () => { observer.disconnect(); };
	}, [vertical]);

	const setSizeInternal = useCallback((next: number) => {
		if (!isControlledSize) setInternalSize(next);
		onSizeChange?.(next);
	}, [isControlledSize, onSizeChange]);

	const setCollapsedInternal = useCallback((next: boolean) => {
		if (!isControlledCollapsed) setInternalCollapsed(next);
		onCollapsedChange?.(next);
	}, [isControlledCollapsed, onCollapsedChange]);

	useImperativeHandle(ref, () => ({
		expand: () => { setCollapsedInternal(false); },
		collapse: () => { setCollapsedInternal(true); },
		toggle: () => { setCollapsedInternal(!collapsed); },
		setSize: (next: number) => { setSizeInternal(next); }
	}), [collapsed, setCollapsedInternal, setSizeInternal]);

	const handleSashStart = useCallback((_event: SashEvent) => {
		sashStartSizeRef.current = size;
		setDragging(true);
	}, [size]);

	const handleSashEnd = useCallback(() => {
		setDragging(false);
	}, []);

	const handleSashChange = useCallback((event: SashEvent) => {
		const max = maxSize ?? Math.max(minSize, containerCrossAxis - MAIN_AREA_RESERVE);
		const start = sashStartSizeRef.current;
		const delta = vertical
			? (side === 'left' ? event.currentX - event.startX : event.startX - event.currentX)
			: (side === 'top' ? event.currentY - event.startY : event.startY - event.currentY);
		const next = Math.min(max, Math.max(minSize, start + delta));
		setSizeInternal(next);
	}, [containerCrossAxis, maxSize, minSize, setSizeInternal, side, vertical]);

	// Sash layout providers. Vertical = left/right docks (sash runs
	// top-to-bottom on the panel's inner edge); horizontal = top/
	// bottom docks (sash runs left-to-right on the panel's inner edge).
	// The sash sits *between* panel and main, so its position is
	// `size` for left / top and `crossAxis - size` for right / bottom.
	const verticalProvider: IVerticalSashLayoutProvider = useMemo(() => ({
		getVerticalSashLeft: () => side === 'left' ? size : Math.max(0, containerCrossAxis - size),
		getVerticalSashTop: () => 0,
		getVerticalSashHeight: () => containerRef.current?.clientHeight ?? 0
	}), [containerCrossAxis, side, size]);

	const horizontalProvider: IHorizontalSashLayoutProvider = useMemo(() => ({
		getHorizontalSashTop: () => side === 'top' ? size : Math.max(0, containerCrossAxis - size),
		getHorizontalSashLeft: () => 0,
		getHorizontalSashWidth: () => containerRef.current?.clientWidth ?? 0
	}), [containerCrossAxis, side, size]);

	const flexDirection = side === 'left' ? 'row'
		: side === 'right' ? 'row-reverse'
		: side === 'top' ? 'column'
		: 'column-reverse';

	// `renderSize` already accounts for the staged collapse / expand
	// animation (overshoot then settle). Pure size changes from a
	// sash drag are mirrored into `renderSize` by the animation
	// effect above, so this single source of truth drives both the
	// inline width / height AND the CSS transition target.
	//
	// The hover-preview overlay does NOT override the panel size:
	// `.dock__panel` keeps its `collapsedSize` flex footprint so the
	// main column stays put on expand AND on fold-back. The preview
	// is rendered by floating `.dock__panel-content` absolutely
	// outwards (see `dock.css`); we just feed the content's target
	// width / height inline below.
	const inPreview = collapsed && previewMode !== 'idle';
	const panelStyle: React.CSSProperties = vertical ? { width: renderSize } : { height: renderSize };
	// During preview we drive the content's size inline so the CSS
	// `width` / `height` transition runs end-to-end: `visible` paints
	// at full `size`, `closing` shrinks back to `collapsedSize`. When
	// `previewMode === 'idle'` we leave the content at its CSS
	// default (100 % of the panel) — the panel itself is at
	// `collapsedSize`, so 100 % equals `collapsedSize` and the swap
	// from absolute back to in-flow is visually invisible.
	const previewContentSize = previewMode === 'visible' ? size
		: previewMode === 'closing' ? collapsedSize
			: null;
	const panelContentStyle: React.CSSProperties | undefined = previewContentSize === null
		? undefined
		: vertical ? { width: previewContentSize } : { height: previewContentSize };

	const containerStyle: React.CSSProperties = { flexDirection, ...style };

	const previewClass = inPreview ? ` dock--preview dock--preview-${previewMode}` : '';

	return (
		<div
			ref={containerRef}
			className={`dock dock--${side}${collapsed ? ' dock--collapsed' : ''}${previewClass}${className ? ` ${className}` : ''}`}
			data-side={side}
			data-collapsed={collapsed ? 'true' : 'false'}
			data-preview={inPreview ? previewMode : 'false'}
			data-dragging={dragging ? 'true' : 'false'}
			style={containerStyle}
			{...(dataTestId !== undefined ? { 'data-testid': dataTestId } : {})}
		>
			{(renderPanel || inPreview) && (
				<div
					className="dock__panel"
					style={panelStyle}
					data-testid={dataTestId !== undefined ? `${dataTestId}-panel` : undefined}
					onMouseEnter={previewOnHover ? handleMouseEnter : undefined}
					onMouseLeave={previewOnHover ? handleMouseLeave : undefined}
				>
					{/* The content wrapper is the layer that floats during
					 * hover-preview (absolute positioning + bloom shadow
					 * applied via `.dock--preview` rules in dock.css). It
					 * also carries the collapse-time opacity fade so the
					 * panel itself can stay opaque for `panelOverlay`. */}
					<div className="dock__panel-content" style={panelContentStyle}>
						{panel}
					</div>
					{panelOverlay !== undefined && (
						<div
							className="dock__panel-overlay"
							data-testid={dataTestId !== undefined ? `${dataTestId}-overlay` : undefined}
						>
							{panelOverlay}
						</div>
					)}
				</div>
			)}
			{!collapsed && (
				<Sash
					orientation={vertical ? 'vertical' : 'horizontal'}
					layoutProvider={vertical ? verticalProvider : horizontalProvider}
					onStart={handleSashStart}
					onChange={handleSashChange}
					onEnd={handleSashEnd}
				/>
			)}
			<div
				className="dock__main"
				data-testid={dataTestId !== undefined ? `${dataTestId}-main` : undefined}
				style={{ flex: '1 1 auto', minWidth: 0, minHeight: 0 }}
			>
				{children}
			</div>
		</div>
	);
});
