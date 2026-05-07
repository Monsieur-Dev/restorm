// Pane-family components — multi-pane resizable layouts (SplitView)
// and chrome-matching standalone panes (StaticPane). Future additions
// (e.g. an edge-anchored Dock) belong in this directory so the
// "panes" family stays discoverable from a single tree node.

export { SplitView, Pane } from './SplitView';
export type {
	SplitViewOrientation,
	SplitViewProps,
	SplitViewPaneProps
} from './SplitView';

export { StaticPane } from './StaticPane';
export type { StaticPaneProps } from './StaticPane';
