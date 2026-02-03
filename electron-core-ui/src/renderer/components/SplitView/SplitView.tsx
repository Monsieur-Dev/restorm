import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Sash } from '../Sash';
import type { SashEvent, IHorizontalSashLayoutProvider } from '../Sash';
import { Pane } from './Pane';
import type { InternalPaneConfig, SplitViewProps } from './types';
import './splitview.css';

function isPaneElement(child: React.ReactNode): child is React.ReactElement<React.ComponentProps<typeof Pane>> {
	return React.isValidElement(child) &&
		(child.type === Pane || (typeof child.type === 'function' && (child.type as { displayName?: string }).displayName === 'Pane'));
}

// Separate component for pane items to avoid ref access during render
interface SplitViewPaneItemProps {
	pane: InternalPaneConfig;
	index: number;
	paneKey: string;
	baseTestId: string;
	ratio: number;
	isCollapsed: boolean;
	isFirstCollapsedAfterExpanded: boolean;
	layoutProvider: IHorizontalSashLayoutProvider;
	onSashStart: (event: SashEvent) => void;
	onSashChange: (event: SashEvent) => void;
	onToggleCollapsed: () => void;
	showSash: boolean;
	nextIsCollapsed: boolean;
}

const SplitViewPaneItem: React.FC<SplitViewPaneItemProps> = ({
	pane,
	index,
	ratio,
	isCollapsed,
	isFirstCollapsedAfterExpanded,
	layoutProvider,
	onSashStart,
	onSashChange,
	onToggleCollapsed,
	showSash,
	nextIsCollapsed,
	paneKey,
	baseTestId
}) => {
	const paneStyle: React.CSSProperties = isCollapsed
		? {
			flexGrow: 0,
			flexShrink: 0,
			flexBasis: `${0 * 100}%`,
			minWidth: 0,
			...(isFirstCollapsedAfterExpanded ? { marginTop: 'auto' } : {})
		}
		: {
			flexGrow: 0,
			flexShrink: 0,
			flexBasis: `${ratio * 100}%`,
			minHeight: 0,
			minWidth: 0
		};

	const paneTestId = `${baseTestId}-pane-${paneKey}`;
	const headerTestId = `${paneTestId}-header`;
	const bodyTestId = `${paneTestId}-body`;

	return (
		<React.Fragment key={pane.id ?? index}>
			<div
				className="split-view-view"
				style={paneStyle}
				data-testid={paneTestId}
				data-pane-id={paneKey}
			>
				{pane.title ? (
					<div
						className={[
							'split-view-view-header',
							pane.collapsible === false ? 'not-collapsible' : ''
						].filter(Boolean).join(' ')}
						data-testid={headerTestId}
						data-is-collapsed={isCollapsed ? 'true' : 'false'}
						onClick={pane.collapsible === false ? undefined : onToggleCollapsed}
					>
						<div className="split-view-view-header-main">
							{pane.collapsible !== false && (
								<i
									className={`codicon ${isCollapsed ? 'codicon-chevron-right' : 'codicon-chevron-down'}`}
								/>
							)}
							<span className="split-view-view-header-title">
								{pane.title}
							</span>
						</div>
						{pane.headerActions ? (
							<div
								className="split-view-view-header-actions"
								onClick={(event): void => {
									event.stopPropagation();
								}}
							>
								{typeof pane.headerActions === 'function'
									? pane.headerActions({
										collapsed: isCollapsed,
										toggle: onToggleCollapsed
									})
									: pane.headerActions}
							</div>
						) : null}
					</div>
				) : null}
				{!isCollapsed ? (
					<div className="split-view-view-body" data-testid={bodyTestId}>
						{pane.children}
					</div>
				) : null}
			</div>
			{showSash ? (
				<Sash
					orientation="horizontal"
					layoutProvider={layoutProvider}
					onStart={onSashStart}
					onChange={onSashChange}
					state={!isCollapsed && !nextIsCollapsed ? 'enabled' : 'disabled'}
					data-testid={`${baseTestId}-sash-${index}`}
				/>
			) : null}
		</React.Fragment>
	);
};
SplitViewPaneItem.displayName = 'SplitViewPaneItem';

function ratiosToPercentString(ratios: number[]): string {
	if (!ratios.length) return '';
	const raw = ratios.map((r) => (Number.isFinite(r) ? Math.max(0, r) : 0));
	const sum = raw.reduce((a, b) => a + b, 0) || 1;
	const normalized = raw.map((r) => r / sum);
	const floors = normalized.map((r) => Math.floor(r * 100));
	let remainder = 100 - floors.reduce((a, b) => a + b, 0);

	const frac: { i: number; f: number }[] = [];
	for (let i = 0; i < normalized.length; i++) {
		const r = normalized[i];
		const floor = floors[i] ?? 0;
		frac.push({ i, f: (r ?? 0) * 100 - floor });
	}
	frac.sort((a, b) => b.f - a.f);
	for (let k = 0; k < frac.length && remainder > 0; k++) {
		const item = frac[k];
		if (!item) break;
		const idx = item.i;
		floors[idx] = (floors[idx] ?? 0) + 1;
		remainder--;
	}

	return floors.join('|');
}

function useSplitRatios(
	count: number,
	containerRef: React.RefObject<HTMLDivElement | null>,
	minSizes: number[],
	maxSizes: (number | undefined)[]
): {
	ratios: number[];
	onSashStart: (index: number, event: SashEvent) => void;
	onSashChange: (index: number, event: SashEvent) => void;
	updateRatios: (updater: (current: number[]) => number[]) => void;
} {
	// Store ratios with the count they were calculated for
	const [ratioState, setRatioState] = useState<{ forCount: number; values: number[] }>({ forCount: 0, values: [] });
	const startRatiosRef = useRef<number[]>([]);
	const startCoordRef = useRef<number>(0);
	const axisSizeRef = useRef<number>(0);

	// Derive effective ratios based on current count
	const ratios = useMemo(() => {
		if (count <= 0) return [];
		// If ratios were set for current count, use them
		if (ratioState.forCount === count && ratioState.values.length === count) {
			return ratioState.values;
		}
		// Otherwise compute equal distribution
		const equal = 1 / count;
		return new Array<number>(count).fill(equal);
	}, [count, ratioState]);

	// Keep a ref to ratios for use in callbacks without re-creating them
	const ratiosRef = useRef(ratios);
	useLayoutEffect(() => {
		ratiosRef.current = ratios;
	}, [ratios]);

	// Wrapper to update ratios while tracking count
	const setRatios = useCallback((updater: number[] | ((prev: number[]) => number[])) => {
		setRatioState(prev => {
			const newValues = typeof updater === 'function' ? updater(prev.values) : updater;
			return { forCount: count, values: newValues };
		});
	}, [count]);

	// Single handler for sash start - takes index as parameter
	const onSashStart = useCallback(
		(index: number, event: SashEvent): void => {
			void index; // Index not needed for start, but kept for API consistency
			const container = containerRef.current;
			const currentRatios = ratiosRef.current;
			if (!container || currentRatios.length !== count) {
				return;
			}
			const rect = container.getBoundingClientRect();
			const axisSize = Math.max(1, rect.height);
			const startCoord = event.startY - rect.top;

			axisSizeRef.current = axisSize;
			startCoordRef.current = startCoord;
			startRatiosRef.current = [...currentRatios];
		},
		[containerRef, count]
	);

	// Single handler for sash change - takes index as parameter
	const onSashChange = useCallback(
		(index: number, event: SashEvent): void => {
			const container = containerRef.current;
			if (index < 0 || index + 1 >= startRatiosRef.current.length || !container) return;

			const rect = container.getBoundingClientRect();
			const currentCoord = event.currentY - rect.top;
			const deltaPx = currentCoord - startCoordRef.current;
			const axisSize = axisSizeRef.current || rect.height || 1;
			const delta = deltaPx / axisSize;

			const leftStart = startRatiosRef.current[index] ?? 0;
			const rightStart = startRatiosRef.current[index + 1] ?? 0;

			let left = leftStart + delta;
			let right = rightStart - delta;

			// Convert pane min/max to ratios
			const leftMin = Math.min(
				0.5,
				(minSizes[index] ?? 0) / axisSize
			);
			const rightMin = Math.min(
				0.5,
				(minSizes[index + 1] ?? 0) / axisSize
			);

			const leftMaxRaw = maxSizes[index];
			const rightMaxRaw = maxSizes[index + 1];
			const leftMax = leftMaxRaw != null ? leftMaxRaw / axisSize : 1;
			const rightMax = rightMaxRaw != null ? rightMaxRaw / axisSize : 1;

			// Apply min constraints
			if (left < leftMin) {
				right -= (leftMin - left);
				left = leftMin;
			}
			if (right < rightMin) {
				left -= (rightMin - right);
				right = rightMin;
			}

			// Apply max constraints
			left = Math.min(leftMax, left);
			right = Math.min(rightMax, right);

			const next = [...startRatiosRef.current];
			const li = index;
			const ri = index + 1;

			let leftVal = Math.max(leftMin, Math.min(1 - rightMin, left));
			let rightVal = Math.max(rightMin, Math.min(1 - leftMin, right));

			next[li] = leftVal;
			next[ri] = rightVal;

			// Normalize total to 1 preserving others
			const sumOthers = startRatiosRef.current.reduce(
				(acc, s, i) => (i === li || i === ri ? acc : acc + s),
				0
			);
			const sumNext = leftVal + rightVal + sumOthers;
			if (sumNext !== 1) {
				const scale = (1 - sumOthers) / (leftVal + rightVal);
				leftVal *= scale;
				rightVal *= scale;
				next[li] = leftVal;
				next[ri] = rightVal;
			}

			setRatios(next);
		},
		[containerRef, minSizes, maxSizes, setRatios]
	);

	const updateRatios = useCallback(
		(updater: (current: number[]) => number[]): void => {
			setRatios(current => {
				const next = updater(current);
				if (!next.length) {
					return [];
				}
				const sum = next.reduce((a, b) => a + b, 0) || 1;
				return next.map(value => value / sum);
			});
		},
		[setRatios]
	);

	return { ratios, onSashStart, onSashChange, updateRatios };
}

export const SplitView: React.FC<SplitViewProps> = ({
	orientation = 'vertical',
	className,
	style,
	onSizesChange,
	children,
	'data-testid': dataTestId
}) => {
	// For now we only support a vertical pane view (panes stacked top to bottom).
	// Orientation is kept for future extension but not used to change behavior.
	const containerRef = useRef<HTMLDivElement | null>(null);

	const panes: InternalPaneConfig[] = useMemo(() => {
		const arr: InternalPaneConfig[] = [];
		React.Children.forEach(children, (child, index) => {
			if (isPaneElement(child)) {
				const props = child.props;
				arr.push({
					...props,
					index
				});
			}
		});
		return arr;
	}, [children]);

	const minSizes = useMemo(
		() => panes.map(p => p.minSize ?? 0),
		[panes]
	);
	const maxSizes = useMemo(
		() => panes.map(p => p.maxSize),
		[panes]
	);

	const { ratios, onSashStart, onSashChange, updateRatios } = useSplitRatios(
		panes.length,
		containerRef,
		minSizes,
		maxSizes
	);

	// Collapsed state per pane - track with count for proper derivation
	const [collapsedState, setCollapsedState] = useState<{ forCount: number; values: boolean[] }>({ forCount: 0, values: [] });
	const collapseAnimationTimeoutRef = useRef<number | null>(null);
	const [isAnimatingCollapse, setIsAnimatingCollapse] = useState(false);

	// Derive collapsed array from state or compute from pane defaults
	const collapsed = useMemo(() => {
		if (collapsedState.forCount === panes.length && collapsedState.values.length === panes.length) {
			return collapsedState.values;
		}
		return panes.map((pane, index) => {
			if (typeof collapsedState.values[index] === 'boolean' && collapsedState.forCount >= index + 1) {
				return collapsedState.values[index];
			}
			if (typeof pane.collapsed === 'boolean') {
				return pane.collapsed;
			}
			return Boolean(pane.defaultCollapsed);
		});
	}, [panes, collapsedState]);

	// Wrapper to update collapsed state
	const setCollapsed = useCallback((updater: boolean[] | ((prev: boolean[]) => boolean[])) => {
		setCollapsedState(prev => {
			const newValues = typeof updater === 'function' ? updater(prev.values) : updater;
			return { forCount: panes.length, values: newValues };
		});
	}, [panes.length]);

	// Helper to compute target ratios for a given collapsed mask and container height.
	const computeRatiosForState = useCallback((collapsedMask: boolean[], containerHeight: number | undefined): number[] => {
		const count = panes.length;
		if (count === 0) {
			return [];
		}

		const collapsedCount = collapsedMask.filter(Boolean).length;
		const expandedCount = count - collapsedCount;

		// Approximate header height (matches CSS min-height / pane header height).
		let headerRatioPerPane = 0;
		if (collapsedCount > 0 && typeof containerHeight === 'number' && containerHeight > 0) {
			const headerHeight = 22; // px
			headerRatioPerPane = Math.min(0.5, headerHeight / containerHeight);
		}

		const remaining = Math.max(0, 1 - headerRatioPerPane * collapsedCount);

		// Weights for expanded panes, based on initialSize when provided.
		const weights: number[] = new Array<number>(count).fill(0);
		let totalWeight = 0;
		for (let i = 0; i < count; i++) {
			if (!collapsedMask[i]) {
				const pane = panes[i];
				const w = pane && typeof pane.initialSize === 'number' ? pane.initialSize : 1;
				weights[i] = w;
				totalWeight += w;
			}
		}

		const unit = totalWeight > 0 && expandedCount > 0 ? remaining / totalWeight : 0;

		const result: number[] = [];
		for (let i = 0; i < count; i++) {
			const base = collapsedMask[i] ? headerRatioPerPane : (weights[i] ?? 0) * unit;
			result.push(base);
		}

		return result;
	}, [panes]);

	const handleToggleCollapsed = useCallback(
		(index: number) => {
			if (index < 0 || index >= panes.length) {
				return;
			}

			setCollapsed(() => {
				const currentCollapsed = collapsed;
				const nextCollapsed = [...currentCollapsed];
				nextCollapsed[index] = !currentCollapsed[index];

				// Enable animated class briefly for collapse/expand transitions
				if (collapseAnimationTimeoutRef.current !== null) {
					window.clearTimeout(collapseAnimationTimeoutRef.current);
					collapseAnimationTimeoutRef.current = null;
				}
				setIsAnimatingCollapse(true);
				collapseAnimationTimeoutRef.current = window.setTimeout(() => {
					setIsAnimatingCollapse(false);
					collapseAnimationTimeoutRef.current = null;
				}, 200);

				// Recompute ratios based on collapsed mask:
				// - collapsed panes get a ratio that matches their header height
				// - remaining space is distributed proportionally to initialSize
				updateRatios(() => {
					const container = containerRef.current;
					const containerHeight = container?.getBoundingClientRect().height;
					return computeRatiosForState(nextCollapsed, containerHeight);
				});

				return nextCollapsed;
			});
		},
		[panes.length, updateRatios, computeRatiosForState, setCollapsed, collapsed]
	);

	// Notify external listener when ratios change
	useEffect(() => {
		if (onSizesChange && ratios.length === panes.length && panes.length > 0) {
			onSizesChange(ratios);
		}
	}, [ratios, panes.length, onSizesChange]);

	// Ensure initial ratios respect the current collapsed mask so that
	// expanded panes consume all remaining height and collapsed panes only
	// take their header space, even before any user interaction.
	useEffect(() => {
		const container = containerRef.current;
		if (!container || panes.length === 0) {
			return;
		}

		updateRatios(() => {
			const rect = container.getBoundingClientRect();
			return computeRatiosForState(collapsed, rect.height);
		});
	}, [collapsed, panes.length, updateRatios, computeRatiosForState]);

	// Recompute ratios when the container is resized so that collapsed panes
	// stay pinned and expanded panes adapt to the new height.
	useEffect(() => {
		const container = containerRef.current;
		if (!container || panes.length === 0) {
			return;
		}

		const resizeObserver = new ResizeObserver(entries => {
			const entry = entries[0];
			if (!entry) {
				return;
			}
			const height = entry.contentRect.height;
			updateRatios(() => computeRatiosForState(collapsed, height));
		});

		resizeObserver.observe(container);

		return () => {
			resizeObserver.disconnect();
		};
	}, [collapsed, panes.length, updateRatios, computeRatiosForState]);

	// Memoize layout providers to avoid ref access warning during render
	const layoutProviders = useMemo(() => {
		return ratios.map((_, index): IHorizontalSashLayoutProvider => ({
			getHorizontalSashTop: (): number => {
				if (!containerRef.current) return 0;
				const rect = containerRef.current.getBoundingClientRect();
				let top = 0;
				for (let i = 0; i <= index; i++) {
					top += (ratios[i] ?? 0) * rect.height;
				}
				return top;
			},
			getHorizontalSashLeft: (): number => {
				return 0;
			},
			getHorizontalSashWidth: (): number => {
				if (!containerRef.current) return 0;
				const rect = containerRef.current.getBoundingClientRect();
				return rect.width;
			}
		}));
	}, [ratios]);

	const rootClassName = [
		'split-view2',
		orientation,
		isAnimatingCollapse ? 'animated' : '',
		className
	].filter(Boolean).join(' ');

	const rootTestId = dataTestId ?? 'split-view';
	const collapsedAttr = collapsed.map((c) => (c ? 'true' : 'false')).join('|');
	const sizesAttr = ratiosToPercentString(ratios);

	// Find the first collapsed pane that comes after at least one expanded pane.
	let firstCollapsedAfterExpanded = -1;
	{
		let seenExpanded = false;
		for (let i = 0; i < panes.length; i++) {
			if (!collapsed[i]) {
				seenExpanded = true;
			} else if (seenExpanded && firstCollapsedAfterExpanded === -1) {
				firstCollapsedAfterExpanded = i;
			}
		}
	}

	// Create stable callbacks for each pane to avoid inline functions in render
	const paneCallbacks = useMemo(() => {
		return panes.map((_, i) => ({
			onSashStart: (event: SashEvent): void => { onSashStart(i, event); },
			onSashChange: (event: SashEvent): void => { onSashChange(i, event); },
			onToggleCollapsed: (): void => { handleToggleCollapsed(i); }
		}));
	}, [panes, onSashStart, onSashChange, handleToggleCollapsed]);

	return (
		<div
			className={rootClassName}
			style={style}
			data-testid={rootTestId}
			data-pane-count={panes.length}
			data-collapsed={collapsedAttr}
			data-sizes={sizesAttr}
		>
			<div ref={containerRef} className="split-view-container">
				{panes.map((pane, i) => (
					<SplitViewPaneItem
						key={pane.id ?? i}
						pane={pane}
						index={i}
						paneKey={pane.id ?? String(i)}
						baseTestId={rootTestId}
						ratio={ratios[i] ?? (1 / Math.max(1, panes.length))}
						isCollapsed={Boolean(collapsed[i])}
						isFirstCollapsedAfterExpanded={i === firstCollapsedAfterExpanded}
						layoutProvider={layoutProviders[i] ?? { getHorizontalSashTop: () => 0, getHorizontalSashLeft: () => 0, getHorizontalSashWidth: () => 0 }}
						onSashStart={paneCallbacks[i]?.onSashStart ?? ((): void => { /* noop */ })}
						onSashChange={paneCallbacks[i]?.onSashChange ?? ((): void => { /* noop */ })}
						onToggleCollapsed={paneCallbacks[i]?.onToggleCollapsed ?? ((): void => { /* noop */ })}
						showSash={i < panes.length - 1}
						nextIsCollapsed={Boolean(collapsed[i + 1])}
					/>
				))}
			</div>
		</div>
	);
};

SplitView.displayName = 'SplitView';
