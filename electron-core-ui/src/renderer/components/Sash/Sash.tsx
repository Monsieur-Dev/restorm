import React, { useRef, useEffect, useState, useCallback } from 'react';
import { isMacintosh } from '../../hooks/usePlatform';
import type { SashProps, SashEvent, IVerticalSashLayoutProvider, IHorizontalSashLayoutProvider } from './types';
import './sash.css';

/**
 * Sash component for resizing panels
 * Sash implementation for resizable panes
 */
export const Sash: React.FC<SashProps> = ({
	orientation,
	layoutProvider,
	state = 'enabled',
	size = 4,
	hoverDelay = 0,
	onStart,
	onChange,
	onEnd,
	onReset,
	className = ''
}) => {
	const elRef = useRef<HTMLDivElement>(null);
	const [isHovered, setIsHovered] = useState(false);
	const [isActive, setIsActive] = useState(false);
	const hoverTimeoutRef = useRef<number | null>(null);
	const isDraggingRef = useRef(false);

	// Sash instance for layout provider
	const sashInstance = useRef({ orientation } as const);

	// Layout the sash based on the layout provider
	const layout = useCallback(() => {
		if (!elRef.current) return;

		if (orientation === 'vertical') {
			const verticalProvider = layoutProvider as IVerticalSashLayoutProvider;
			const left = verticalProvider.getVerticalSashLeft(sashInstance.current);
			elRef.current.style.left = `${left - size / 2}px`;

			if (verticalProvider.getVerticalSashTop) {
				elRef.current.style.top = `${verticalProvider.getVerticalSashTop(sashInstance.current)}px`;
			}

			if (verticalProvider.getVerticalSashHeight) {
				elRef.current.style.height = `${verticalProvider.getVerticalSashHeight(sashInstance.current)}px`;
			}
		} else {
			const horizontalProvider = layoutProvider as IHorizontalSashLayoutProvider;
			const top = horizontalProvider.getHorizontalSashTop(sashInstance.current);
			elRef.current.style.top = `${top - size / 2}px`;

			if (horizontalProvider.getHorizontalSashLeft) {
				elRef.current.style.left = `${horizontalProvider.getHorizontalSashLeft(sashInstance.current)}px`;
			}

			if (horizontalProvider.getHorizontalSashWidth) {
				elRef.current.style.width = `${horizontalProvider.getHorizontalSashWidth(sashInstance.current)}px`;
			}
		}
	}, [orientation, layoutProvider, size]);

	// Update layout when dependencies change
	useEffect(() => {
		layout();
	}, [layout]);

	// Update layout when container resizes
	useEffect(() => {
		const container = elRef.current?.parentElement;
		if (!container) return;

		const resizeObserver = new ResizeObserver(() => {
			layout();
		});

		resizeObserver.observe(container);

		return () => {
			resizeObserver.disconnect();
		};
	}, [layout]);

	// Handle mouse enter with delay
	const handleMouseEnter = useCallback(() => {
		if (hoverTimeoutRef.current) {
			clearTimeout(hoverTimeoutRef.current);
			hoverTimeoutRef.current = null;
		}
		if (isActive) {
			setIsHovered(true);
		} else {
			if (hoverDelay === 0) {
				setIsHovered(true);
				return;
			}
			hoverTimeoutRef.current = window.setTimeout(() => {
				setIsHovered(true);
				hoverTimeoutRef.current = null;
			}, hoverDelay);
		}
	}, [isActive, hoverDelay]);

	// Handle mouse leave
	const handleMouseLeave = useCallback(() => {
		// Don't remove hover during drag
		if (isDraggingRef.current || isActive) {
			return;
		}
		if (hoverTimeoutRef.current) {
			clearTimeout(hoverTimeoutRef.current);
			hoverTimeoutRef.current = null;
		}
		setIsHovered(false);
	}, [isActive]);

	// Handle pointer start (mousedown)
	const handlePointerStart = useCallback((e: React.MouseEvent) => {
		if (state === 'disabled') return;

		e.preventDefault();
		e.stopPropagation();

		// Disable pointer events on iframes during drag
		const iframes = document.getElementsByTagName('iframe');
		for (const iframe of iframes) {
			iframe.classList.add('pointer-events-disabled');
		}

		const startX = e.pageX;
		const startY = e.pageY;
		const altKey = e.altKey;
		isDraggingRef.current = true;
		setIsActive(true);
		setIsHovered(true);

		const startEvent: SashEvent = {
			startX,
			currentX: startX,
			startY,
			currentY: startY,
			altKey
		};

		onStart?.(startEvent);

		// Create style element for cursor
		const style = document.createElement('style');
		let cursor = '';
		if (orientation === 'horizontal') {
			if (state === 'atMinimum') {
				cursor = 's-resize';
			} else if (state === 'atMaximum') {
				cursor = 'n-resize';
			} else {
				cursor = isMacintosh ? 'row-resize' : 'ns-resize';
			}
		} else {
			if (state === 'atMinimum') {
				cursor = 'e-resize';
			} else if (state === 'atMaximum') {
				cursor = 'w-resize';
			} else {
				cursor = isMacintosh ? 'col-resize' : 'ew-resize';
			}
		}
		style.textContent = `* { cursor: ${cursor} !important; }`;
		document.head.appendChild(style);

		// Handle mouse move
		const handleMouseMove = (ev: MouseEvent): void => {
			ev.preventDefault();
			ev.stopPropagation();
			const event: SashEvent = {
				startX,
				currentX: ev.pageX,
				startY,
				currentY: ev.pageY,
				altKey
			};
			onChange?.(event);
		};

		// Handle mouse up
		const handleMouseUp = (ev: MouseEvent): void => {
			ev.preventDefault();
			ev.stopPropagation();

			style.remove();
			setIsActive(false);
			isDraggingRef.current = false;
			onEnd?.();

			// Re-enable pointer events on iframes
			for (const iframe of iframes) {
				iframe.classList.remove('pointer-events-disabled');
			}

			// Check if mouse is still over the sash element
			if (elRef.current) {
				const rect = elRef.current.getBoundingClientRect();
				const isMouseOver = ev.clientX >= rect.left && ev.clientX <= rect.right &&
					ev.clientY >= rect.top && ev.clientY <= rect.bottom;
				
				if (isMouseOver) {
					// Mouse is still over, keep hover state
					setIsHovered(true);
				} else {
					// Mouse left, remove hover state
					setIsHovered(false);
				}
			} else {
				setIsHovered(false);
			}

			window.removeEventListener('mousemove', handleMouseMove);
			window.removeEventListener('mouseup', handleMouseUp);
		};

		window.addEventListener('mousemove', handleMouseMove);
		window.addEventListener('mouseup', handleMouseUp);
	}, [state, orientation, onStart, onChange, onEnd]);

	// Handle double click
	const handleDoubleClick = useCallback((e: React.MouseEvent) => {
		if (state === 'disabled') return;
		e.preventDefault();
		e.stopPropagation();
		onReset?.();
	}, [state, onReset]);

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			if (hoverTimeoutRef.current) {
				clearTimeout(hoverTimeoutRef.current);
			}
		};
	}, []);

	// Build CSS classes
	const classes = [
		'sash',
		orientation,
		state === 'disabled' && 'disabled',
		state === 'atMinimum' && 'minimum',
		state === 'atMaximum' && 'maximum',
		isMacintosh && 'mac',
		isHovered && 'hover',
		isActive && 'active',
		className
	].filter(Boolean).join(' ');

	// Set size styles
	const style: React.CSSProperties = {
		width: orientation === 'vertical' ? `${size}px` : 'auto',
		height: orientation === 'horizontal' ? `${size}px` : 'auto'
	};

	return (
		<div
			ref={elRef}
			className={classes}
			style={style}
			onMouseDown={handlePointerStart}
			onDoubleClick={handleDoubleClick}
			onMouseEnter={handleMouseEnter}
			onMouseLeave={handleMouseLeave}
			role="separator"
			aria-orientation={orientation}
		/>
	);
};

export default Sash;
