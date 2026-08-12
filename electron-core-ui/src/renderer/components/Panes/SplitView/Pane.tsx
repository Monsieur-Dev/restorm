import React from 'react';
import type { SplitViewPaneProps } from './types';

export const Pane: React.FC<SplitViewPaneProps> = (_props) => {
	// This component is only a declarative wrapper.
	// Actual rendering is handled by SplitView by inspecting its children.
	return null;
};
