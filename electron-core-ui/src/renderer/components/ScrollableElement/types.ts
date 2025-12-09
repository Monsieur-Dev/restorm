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

type ScrollableElementDomProps = Omit<
  React.HTMLAttributes<HTMLDivElement>,
  'onScroll' | 'className' | 'style'
>;

export interface ScrollableElementProps extends ScrollableElementDomProps {
  children: React.ReactNode;
  options?: IScrollableElementOptions;
  /** Class applied to the outer scrollable container */
  className?: string;
  /** Additional class applied to the inner scrollable content element */
  contentClassName?: string;
  id?: string;
  style?: React.CSSProperties;
  /** Logical scroll callback with numeric coordinates */
  onScroll?: (scrollTop: number, scrollLeft: number) => void;
  /** Optional ref to the inner scrollable content element */
  contentRef?: React.MutableRefObject<HTMLDivElement | null> | ((instance: HTMLDivElement | null) => void);
}

export const defaultScrollableElementStyles: IScrollableElementStyles = {
  scrollbarSliderBackground: 'var(--ecui-scrollbarSlider-background)',
  scrollbarSliderHoverBackground: 'var(--ecui-scrollbarSlider-hoverBackground)',
  scrollbarSliderActiveBackground: 'var(--ecui-scrollbarSlider-activeBackground)',
  scrollbarShadow: 'var(--ecui-scrollbar-shadow)'
};


