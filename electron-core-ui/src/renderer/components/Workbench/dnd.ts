export const DND_MIME = {
	editor: 'application/x-workbench-editor',
	group: 'application/x-workbench-editor-group'
} as const;

export interface DragEditorPayload {
	editorId: string;
	sourceGroupId: string;
}

let currentDragData: DragEditorPayload | undefined;

export function setEditorDragData(e: React.DragEvent, data: DragEditorPayload): void {
	try {
		e.dataTransfer.setData(DND_MIME.editor, JSON.stringify(data));
		// Fallback channel for some environments
		e.dataTransfer.setData('text/plain', data.editorId);
		e.dataTransfer.effectAllowed = 'copyMove';
	} catch {
		// ignore
	}
	currentDragData = data;
}

export function getEditorDragData(e: React.DragEvent | DragEvent): DragEditorPayload | undefined {
	try {
		const raw = e.dataTransfer?.getData(DND_MIME.editor);
		if (!raw) return undefined;
		return JSON.parse(raw) as DragEditorPayload;
	} catch {
		// As fallback, return last known data set on drag start
		return currentDragData;
	}
}

export function isEditorDragEvent(e: React.DragEvent | DragEvent): boolean {
	try {
		const types = e.dataTransfer?.types;
		if (!types) return currentDragData !== undefined;
		const arr = Array.from(types);
		if (arr.includes(DND_MIME.editor)) return true;
		// Fallback for environments (including some test runners) where custom MIME types are not preserved
		// across drag events (dragover/drop), but we still have the in-memory payload.
		return currentDragData !== undefined;
	} catch {
		return currentDragData !== undefined;
	}
}

export function computeDropIndex(container: HTMLElement, clientX: number): number {
	const children = Array.from(container.children).filter((el): el is HTMLElement => el instanceof HTMLElement && el.classList.contains('tab'));
	for (let i = 0; i < children.length; i++) {
		const child = children[i];
		if (!child) continue;
		const rect = child.getBoundingClientRect();
		const mid = rect.left + rect.width / 2;
		if (clientX < mid) return i;
	}
	return children.length;
}

export function clearEditorDragData(): void {
	currentDragData = undefined;
}
