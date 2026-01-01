import React from 'react';
import type { EditorTab, EditorWorkbenchCallbacks } from './types';

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
	renderTabTitle
}) => {
	// Use renderTabTitle if provided, otherwise use tab.title directly
	const titleContent = renderTabTitle ? renderTabTitle(tab) : tab.title;
	
	return (
		<div
			ref={refCallback}
			className={`tab${isActive ? ' active' : ''}${tab.isDirty ? ' dirty' : ''}${
				showDropMarker ? (showDropMarker === 'left' ? ' drop-target-left' : ' drop-target-right') : ''
			}`}
			role="tab"
			aria-selected={isActive}
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
				<span className="label-name">{titleContent}</span>
			</div>
		<div className="tab-actions">
			{tab.isDirty && (
				<span
					className="action-label codicon codicon-circle-filled dirty-indicator"
					aria-label="Modified"
					title="Modified"
				/>
			)}
			<button
				aria-label="Close"
				title="Close"
				onClick={(e) => {
					e.stopPropagation();
					onClose?.(tab.id);
				}}
				className="action-label codicon codicon-close"
				style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
			/>
		</div>
		</div>
	);
};

export default Tab;
