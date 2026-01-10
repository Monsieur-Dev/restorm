/**
 * Orientation of the sash
 */
export type SashOrientation = 'vertical' | 'horizontal';

/**
 * State of the sash
 */
export type SashState = 'enabled' | 'disabled' | 'atMinimum' | 'atMaximum';

/**
 * Event fired during sash drag operations
 */
export interface SashEvent {
	readonly startX: number;
	readonly currentX: number;
	readonly startY: number;
	readonly currentY: number;
	readonly altKey: boolean;
}

/**
 * Layout provider for vertical sash
 */
export interface IVerticalSashLayoutProvider {
	getVerticalSashLeft(sash: Sash): number;
	getVerticalSashTop?(sash: Sash): number;
	getVerticalSashHeight?(sash: Sash): number;
}

/**
 * Layout provider for horizontal sash
 */
export interface IHorizontalSashLayoutProvider {
	getHorizontalSashTop(sash: Sash): number;
	getHorizontalSashLeft?(sash: Sash): number;
	getHorizontalSashWidth?(sash: Sash): number;
}

/**
 * Layout provider type (vertical or horizontal)
 */
export type SashLayoutProvider = IVerticalSashLayoutProvider | IHorizontalSashLayoutProvider;

/**
 * Reference to a Sash instance (for layout providers)
 */
export interface Sash {
	readonly orientation: SashOrientation;
}

/**
 * Props for the Sash component
 */
export interface SashProps {
	/**
	 * Orientation of the sash
	 */
	orientation: SashOrientation;

	/**
	 * Layout provider to position the sash
	 */
	layoutProvider: SashLayoutProvider;

	/**
	 * State of the sash
	 */
	state?: SashState;

	/**
	 * Size of the sash (width for vertical, height for horizontal)
	 * Defaults to 4px
	 */
	size?: number;

	/**
	 * Delay before showing hover state (in ms)
	 * Defaults to 300ms
	 */
	hoverDelay?: number;

	/**
	 * Called when the user starts dragging the sash
	 */
	onStart?: (event: SashEvent) => void;

	/**
	 * Called when the user moves the mouse while dragging
	 */
	onChange?: (event: SashEvent) => void;

	/**
	 * Called when the user stops dragging the sash
	 */
	onEnd?: () => void;

	/**
	 * Called when the user double-clicks the sash
	 */
	onReset?: () => void;

	/**
	 * Additional CSS class name
	 */
	className?: string;
}

/**
 * Configuration options for the Sash component
 */
export interface SashConfig {
	/** Size of the sash (width for vertical, height for horizontal). Defaults to 4px */
	size?: number;
	/** Delay before showing hover state (in ms). Defaults to 0 */
	hoverDelay?: number;
	/** Called when the user double-clicks the sash */
	onReset?: () => void;
	/** Additional CSS class name for the sash */
	className?: string;
}

/**
 * Props for VerticalSashContainer component
 */
export interface VerticalSashContainerProps {
	/** Content to display on the left side */
	Left?: React.ReactNode;
	/** Content to display on the right side */
	Right?: React.ReactNode;
	/** Content to display on the left side when resizing (for performance optimization) */
	LeftWhenResizing?: React.ReactNode;
	/** Content to display on the right side when resizing (for performance optimization) */
	RightWhenResizing?: React.ReactNode;
	/** Initial width of the left panel */
	initialWidth?: number;
	/** Minimum width for the left panel */
	minLeftWidth?: number;
	/** Minimum width for the right panel */
	minRightWidth?: number;
	/** Storage key for persisting width */
	storageKey?: string;
	/** Additional CSS class name */
	className?: string;
	/** Configuration for the Sash component */
	sashConfig?: SashConfig;
}

/**
 * Props for HorizontalSashContainer component
 */
export interface HorizontalSashContainerProps {
	/** Content to display on the top side */
	Top?: React.ReactNode;
	/** Content to display on the bottom side */
	Bottom?: React.ReactNode;
	/** Content to display on the top side when resizing (for performance optimization) */
	TopWhenResizing?: React.ReactNode;
	/** Content to display on the bottom side when resizing (for performance optimization) */
	BottomWhenResizing?: React.ReactNode;
	/** Initial height of the top panel */
	initialHeight?: number;
	/** Minimum height for the top panel */
	minTopHeight?: number;
	/** Minimum height for the bottom panel */
	minBottomHeight?: number;
	/** Storage key for persisting height */
	storageKey?: string;
	/** Additional CSS class name */
	className?: string;
	/** Configuration for the Sash component */
	sashConfig?: SashConfig;
}
