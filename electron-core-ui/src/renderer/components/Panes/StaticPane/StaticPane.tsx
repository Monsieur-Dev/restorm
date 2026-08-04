import React from 'react';
import './staticPane.css';

export interface StaticPaneProps {
	/**
	 * Header title rendered in the pane's uppercase section header.
	 * Mirrors the visual style of `SplitView`'s `Pane` header so a
	 * stack of `StaticPane`s blends with a neighbouring `SplitView`.
	 */
	title?: React.ReactNode;
	/**
	 * Optional actions area rendered on the right side of the header
	 * (e.g. an "Add row" `+` button). Always at full opacity — unlike
	 * `SplitView` panes, which dim their actions to half opacity until
	 * hovered — because a static stack is typically used where the
	 * action is the only affordance.
	 */
	headerActions?: React.ReactNode;
	children?: React.ReactNode;
	/** Additional CSS class applied to the pane root. */
	className?: string;
	/** Optional test id applied to the pane root element. */
	'data-testid'?: string;
}

/**
 * `StaticPane` renders a single pane with the same visual chrome as
 * `SplitView`'s `Pane` (uppercase header with optional right-aligned
 * actions) but without the sash / collapse / resize machinery.
 *
 * Unlike `Pane`, it is a real rendered component: drop it into a
 * plain flex column and stack several of them. Each pane sizes to its
 * content, and inserting / removing children of one pane pushes the
 * neighbours down in natural document flow — no ratio juggling.
 *
 * Typical use: a configuration panel with a handful of named
 * sub-sections whose heights grow with user input.
 */
export const StaticPane: React.FC<StaticPaneProps> = ({
	title,
	headerActions,
	children,
	className,
	'data-testid': dataTestId
}) => {
	const rootClassName = ['static-pane', className].filter(Boolean).join(' ');
	return (
		<div
			className={rootClassName}
			{...(dataTestId && { 'data-testid': dataTestId })}
		>
			{(title !== undefined || headerActions !== undefined) && (
				<div className="static-pane-header">
					<span className="static-pane-header-title">{title}</span>
					{headerActions !== undefined && (
						<div className="static-pane-header-actions">{headerActions}</div>
					)}
				</div>
			)}
			<div className="static-pane-body">{children}</div>
		</div>
	);
};

export default StaticPane;
