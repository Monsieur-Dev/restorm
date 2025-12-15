import React from 'react';
import type { EditorTab } from './types';

/**
 * Extract a string from a React.ReactNode.
 * For simple cases (string, number, boolean), returns the string representation.
 * For complex React nodes, returns a fallback string or the provided default.
 */
export function extractTextFromReactNode(node: React.ReactNode, fallback = ''): string {
	if (node === null || node === undefined) {
		return fallback;
	}
	if (typeof node === 'string') {
		return node;
	}
	if (typeof node === 'number' || typeof node === 'boolean') {
		return String(node);
	}
	if (Array.isArray(node)) {
		return node.map((n: React.ReactNode) => extractTextFromReactNode(n, '')).join('');
	}
	if (React.isValidElement(node)) {
		// For React elements, try to extract text from children
		const children = (node.props as { children?: React.ReactNode }).children
		if (children) {
			return extractTextFromReactNode(children, fallback);
		}
	}
	// For complex nodes, return fallback
	return fallback;
}

/**
 * Get the string representation of a tab's title for serialization purposes.
 * Uses titleString if available, otherwise extracts text from title.
 */
export function getTabTitleString(tab: EditorTab, fallback = ''): string {
	if (tab.titleString !== undefined) {
		return tab.titleString;
	}
	return extractTextFromReactNode(tab.title, fallback);
}
