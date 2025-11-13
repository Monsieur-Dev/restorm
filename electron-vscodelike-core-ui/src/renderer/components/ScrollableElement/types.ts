export interface IScrollableElementStyles {
  readonly scrollbarSliderBackground?: string;
  readonly scrollbarSliderHoverBackground?: string;
  readonly scrollbarSliderActiveBackground?: string;
  readonly scrollbarShadow?: string;
}

export interface IScrollableElementOptions extends IScrollableElementStyles {
  readonly useShadows?: boolean;
  readonly handleMouseWheel?: boolean;
  readonly mouseWheelSmoothScroll?: boolean;
	/**
	 * If true, converts vertical mouse wheel (deltaY) to horizontal scroll (deltaX).
	 * Useful for horizontal-only scrolling contexts like tab bars.
	 */
	readonly mouseWheelHorizontal?: boolean;
  readonly horizontal?: 'auto' | 'visible' | 'hidden';
  readonly vertical?: 'auto' | 'visible' | 'hidden';
  readonly horizontalScrollbarSize?: number;
  readonly verticalScrollbarSize?: number;
  readonly horizontalHasArrows?: boolean;
  readonly verticalHasArrows?: boolean;
  readonly arrowSize?: number;
  readonly scrollByPage?: boolean;
}

export interface ScrollableElementProps {
  children: React.ReactNode;
  options?: IScrollableElementOptions;
  className?: string;
  id?: string;
  style?: React.CSSProperties;
  onScroll?: (scrollTop: number, scrollLeft: number) => void;
}

export const defaultScrollableElementStyles: IScrollableElementStyles = {
  scrollbarSliderBackground: 'var(--vscode-scrollbarSlider-background)',
  scrollbarSliderHoverBackground: 'var(--vscode-scrollbarSlider-hoverBackground)',
  scrollbarSliderActiveBackground: 'var(--vscode-scrollbarSlider-activeBackground)',
  scrollbarShadow: 'var(--vscode-scrollbar-shadow)'
};


