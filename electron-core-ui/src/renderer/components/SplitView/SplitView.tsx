import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sash } from '../Sash';
import type { SashEvent, IHorizontalSashLayoutProvider } from '../Sash';
import { Pane } from './Pane';
import type { InternalPaneConfig, SplitViewProps } from './types';
import './splitview.css';

function isPaneElement(child: React.ReactNode): child is React.ReactElement<React.ComponentProps<typeof Pane>> {
	return Boolean(
		React.isValidElement(child) &&
		(child.type === Pane || (typeof child.type === 'function' && (child.type as { displayName?: string }).displayName === 'Pane'))
	);
}

function useSplitRatios(
	count: number,
	containerRef: React.RefObject<HTMLDivElement>,
	minSizes: number[],
	maxSizes: (number | undefined)[]
): {
	ratios: number[];
	onSashStart: (index: number) => (event: SashEvent) => void;
	onSashChange: (index: number) => (event: SashEvent) => void;
	updateRatios: (updater: (current: number[]) => number[]) => void;
} {
	const [ratios, setRatios] = useState<number[]>([]);
	const startRatiosRef = useRef<number[]>([]);
	const startCoordRef = useRef<number>(0);
	const axisSizeRef = useRef<number>(0);

	useEffect(() => {
		if (count <= 0) {
			setRatios([]);
			return;
		}

		// Initialize ratios if size changed
		setRatios(prev => {
			if (prev.length === count) {
				return prev;
			}
			const equal = 1 / count;
			return new Array(count).fill(equal);
		});
	}, [count]);

	const onSashStart = useCallback(
		(index: number) => {
			return (event: SashEvent): void => {
				// Mark index as used to satisfy TypeScript; we don't need per-sash state on start.
				void index;
				if (!containerRef.current || ratios.length !== count) {
					return;
				}
				const rect = containerRef.current.getBoundingClientRect();
				const axisSize = Math.max(1, rect.height);
				const startCoord = event.startY - rect.top;

				axisSizeRef.current = axisSize;
				startCoordRef.current = startCoord;
				startRatiosRef.current = [...ratios];
			};
		},
		[ratios, count, containerRef]
	);

	const onSashChange = useCallback(
		(index: number) => {
			return (event: SashEvent): void => {
				if (index < 0 || index + 1 >= startRatiosRef.current.length || !containerRef.current) return;

				const rect = containerRef.current.getBoundingClientRect();
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
			};
		},
		[containerRef, minSizes, maxSizes]
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
		[]
	);

	return { ratios, onSashStart, onSashChange, updateRatios };
}

export const SplitView: React.FC<SplitViewProps> = ({
	orientation = 'vertical',
	className,
	style,
	onSizesChange,
	children
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

	// Collapsed state per pane
	const [collapsed, setCollapsed] = useState<boolean[]>([]);
	const collapseAnimationTimeoutRef = useRef<number | null>(null);
	const [isAnimatingCollapse, setIsAnimatingCollapse] = useState(false);

	useEffect(() => {
		setCollapsed(prev => {
			if (prev.length === panes.length) {
				return prev;
			}
			return panes.map((pane, index) => {
				if (typeof prev[index] === 'boolean') {
					return prev[index] as boolean;
				}
				if (typeof pane.collapsed === 'boolean') {
					return pane.collapsed;
				}
				return Boolean(pane.defaultCollapsed);
			});
		});
	}, [panes]);

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

			setCollapsed(prev => {
				const nextCollapsed = [...prev];
				nextCollapsed[index] = !prev[index];

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
		[panes.length, updateRatios, computeRatiosForState]
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

	const createLayoutProvider = useCallback(
		(index: number): IHorizontalSashLayoutProvider => {
			return {
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
			};
		},
		[ratios]
	);

	const rootClassName = [
		'monaco-split-view2',
		orientation,
		isAnimatingCollapse ? 'animated' : '',
		className
	].filter(Boolean).join(' ');

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

	return (
		<div className={rootClassName} style={style}>
			<div ref={containerRef} className="split-view-container">
				{panes.map((pane, i) => {
					const ratio = ratios[i] ?? (1 / Math.max(1, panes.length));
					const paneStyle: React.CSSProperties = collapsed[i]
						? {
							// Collapsed panes only show their header.
							// Use a percentage flex-basis so transitions animate when
							// expanding/collapsing; the visual height is clamped by CSS.
							flexGrow: 0,
							flexShrink: 0,
							flexBasis: `${0 * 100}%`,
							minWidth: 0,
							// When there is at least one expanded pane above, pin the first
							// collapsed pane block to the bottom by consuming remaining space.
							...(i === firstCollapsedAfterExpanded ? { marginTop: 'auto' } : {})
						}
						: {
							// Expanded panes take proportional remaining height.
							flexGrow: 0,
							flexShrink: 0,
							flexBasis: `${ratio * 100}%`,
							minHeight: 0,
							minWidth: 0
						};

					return (
						<React.Fragment key={pane.id ?? i}>
							<div className="split-view-view" style={paneStyle}>
								{pane.title ? (
									<div
										className={[
											'split-view-view-header',
											pane.collapsible === false ? 'not-collapsible' : ''
										].filter(Boolean).join(' ')}
										onClick={pane.collapsible === false ? undefined : () => { handleToggleCollapsed(i); }}
									>
										<div className="split-view-view-header-main">
											{pane.collapsible !== false && (
												<i
													className={`codicon ${collapsed[i] ? 'codicon-chevron-right' : 'codicon-chevron-down'}`}
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
													// Prevent header click from toggling when clicking actions.
													event.stopPropagation();
												}}
											>
												{typeof pane.headerActions === 'function'
													? pane.headerActions({
														collapsed: Boolean(collapsed[i]),
														toggle: () => {
															handleToggleCollapsed(i);
														}
													})
													: pane.headerActions}
											</div>
										) : null}
									</div>
								) : null}
								{!collapsed[i] ? (
									<div className="split-view-view-body">
										{pane.children}
									</div>
								) : null}
							</div>
							{i < panes.length - 1 ? (
								<Sash
									orientation="horizontal"
									layoutProvider={createLayoutProvider(i)}
									onStart={onSashStart(i)}
									onChange={onSashChange(i)}
									// Only make the sash usable when both adjacent panes are expanded.
									state={!collapsed[i] && !collapsed[i + 1] ? 'enabled' : 'disabled'}
								/>
							) : null}
						</React.Fragment>
					);
				})}
			</div>
		</div>
	);
};

SplitView.displayName = 'SplitView';
