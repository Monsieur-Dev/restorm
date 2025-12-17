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
  /**
   * If true, the content will use height: auto instead of height: 100%.
   * Use this when the ScrollableElement has a max-height and should fit its content.
   */
  readonly fitContent?: boolean;
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
  scrollbarSliderBackground: 'var(--vscode-scrollbarSlider-background)',
  scrollbarSliderHoverBackground: 'var(--vscode-scrollbarSlider-hoverBackground)',
  scrollbarSliderActiveBackground: 'var(--vscode-scrollbarSlider-activeBackground)',
  scrollbarShadow: 'var(--vscode-scrollbar-shadow)'
};
