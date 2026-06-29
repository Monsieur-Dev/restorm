import React, { useRef, useState } from 'react';
import type { EditorTab, EditorWorkbenchCallbacks } from './types';
import { Button } from '../Button';
import { Tooltip } from '../Tooltip';

export interface TabProps extends Pick<EditorWorkbenchCallbacks, 'renderTabTitle'> {
	tab: EditorTab;
	isActive: boolean;
	onActivate?: (tabId: string) => void;
	onClose?: (tabId: string) => void;
	onDoubleClick?: (tabId: string) => void;
	onContextMenu?: (event: React.MouseEvent<HTMLDivElement>) => void;
	draggable?: boolean;
	onDragStart?: (e: React.DragEvent) => void;
	onDragEnd?: (e: React.DragEvent) => void;
	showDropMarker?: 'left' | 'right' | undefined;
	/**
	 * Optional ref callback for FLIP animations. Receives the root div element.
	 */
	refCallback?: (el: HTMLDivElement | null) => void;
	/**
	 * Optional test id for stable E2E selectors.
	 */
	'data-testid'?: string;
}

export const Tab: React.FC<TabProps> = ({
	tab,
	isActive,
	onActivate,
	onClose,
	onDoubleClick,
	onContextMenu,
	draggable,
	onDragStart,
	onDragEnd,
	showDropMarker,
	refCallback,
	renderTabTitle,
	'data-testid': dataTestId
}) => {
	// Use renderTabTitle if provided, otherwise use tab.title directly
	const titleContent = renderTabTitle ? renderTabTitle(tab) : tab.title;
	const closeRef = useRef<HTMLSpanElement>(null);
	const [showCloseTooltip, setShowCloseTooltip] = useState(false);

	return (
		<div
			ref={refCallback}
			className={`tab${isActive ? ' active' : ''}${tab.isDirty ? ' dirty' : ''}${
				showDropMarker ? (showDropMarker === 'left' ? ' drop-target-left' : ' drop-target-right') : ''
			}`}
			role="tab"
			aria-selected={isActive}
			{...(dataTestId && {
				'data-testid': dataTestId,
				'data-is-active': isActive ? 'true' : 'false',
				'data-is-dirty': tab.isDirty ? 'true' : 'false'
			})}
			onClick={() => onActivate?.(tab.id)}
			onDoubleClick={() => onDoubleClick?.(tab.id)}
			onContextMenu={onContextMenu}
			onAuxClick={(e) => {
				if (e.button === 1) {
					e.preventDefault();
					e.stopPropagation();
					onClose?.(tab.id);
				}
			}}
			draggable={draggable}
			onDragStart={onDragStart}
			onDragEnd={onDragEnd}
		>
			<div className="tab-label">
				<span {...(dataTestId && { 'data-testid': `${dataTestId}-label` })} className="label-name">
					{titleContent}
				</span>
			</div>
		<div className="tab-actions">
			{tab.isDirty && (
				<span
					className="action-label codicon codicon-circle-filled dirty-indicator"
					aria-label="Modified"
				/>
			)}
			<span
				ref={closeRef}
				style={{ display: 'inline-flex' }}
				onMouseEnter={() => { setShowCloseTooltip(true) }}
				onMouseLeave={() => { setShowCloseTooltip(false) }}
			>
				<Button
					line
					icon="close"
					options={{ ariaLabel: 'Close' }}
					className="action-label"
					{...(dataTestId && { 'data-testid': `${dataTestId}-close` })}
					onClick={(e) => {
						e.stopPropagation();
						onClose?.(tab.id);
					}}
				/>
			</span>
			<Tooltip
				targetRef={closeRef}
				content="Close"
				show={showCloseTooltip}
				placement="below"
			/>
		</div>
		</div>
	);
};

export default Tab;
