import type React from 'react';

export type SplitViewOrientation = 'vertical' | 'horizontal';

export interface SplitViewHeaderActionsContext {
	collapsed: boolean;
	toggle: () => void;
}

export type SplitViewHeaderActionsRender =
	(context: SplitViewHeaderActionsContext) => React.ReactNode;

export interface SplitViewPaneProps {
	id?: string;
	title?: React.ReactNode;
	/**
	 * Optional actions area rendered on the right side of the header.
	 * Rendered at half opacity while the pane is not hovered and at full
	 * opacity on hover or focus — always present, clickable and in the
	 * tab order in both states.
	 */
	headerActions?: React.ReactNode | SplitViewHeaderActionsRender;
	/**
	 * Render the header actions at full opacity even when the pane is not
	 * hovered, instead of the default idle dimming. Useful when the pane's
	 * action is the sole affordance for a common task and any dimming at
	 * all costs it discoverability. Defaults to false.
	 */
	alwaysShowHeaderActions?: boolean;
	/**
	 * Whether this pane can be collapsed from its header.
	 * Defaults to true.
	 */
	collapsible?: boolean;
	/**
	 * Initial collapsed state when the SplitView mounts.
	 */
	defaultCollapsed?: boolean;
	/**
	 * Optional controlled collapsed state. When provided, it will be used
	 * as the initial collapsed value for this pane (for now).
	 * Defaults to false.
	 */
	collapsed?: boolean;
	/**
	 * Minimum size in pixels for this pane.
	 */
	minSize?: number;
	/**
	 * Maximum size in pixels for this pane.
	 */
	maxSize?: number;
	/**
	 * Initial size ratio (0-1) relative to the SplitView container.
	 * When omitted, remaining space is distributed equally.
	 */
	initialSize?: number;
	children?: React.ReactNode;
}

export interface InternalPaneConfig extends SplitViewPaneProps {
	/**
	 * Index of the pane in the rendered order.
	 */
	index: number;
}

export interface SplitViewProps {
	orientation?: SplitViewOrientation;
	className?: string;
	style?: React.CSSProperties;
	/**
	 * Optional test id for the SplitView root.
	 */
	'data-testid'?: string;
	/**
	 * Called whenever pane size ratios change after a drag.
	 * Sizes are normalized and always sum to 1.
	 */
	onSizesChange?: (sizes: number[]) => void;
	/**
	 * Called whenever a pane is collapsed or expanded from its header.
	 * The argument is the full per-pane mask in the same order as the
	 * Pane children. Use to persist collapse state across sessions.
	 */
	onCollapsedChange?: (collapsed: boolean[]) => void;
	children?: React.ReactNode;
}
