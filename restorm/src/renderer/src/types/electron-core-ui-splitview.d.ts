import type React from 'react'
import 'electron-core-ui/renderer'

declare module 'electron-core-ui/renderer' {
  export { SplitView, Pane } from 'electron-core-ui/dist/src/renderer/components/SplitView'
  export type {
    SplitViewOrientation,
    SplitViewProps,
    SplitViewPaneProps,
    SplitViewHeaderActionsContext,
    SplitViewHeaderActionsRender
  } from 'electron-core-ui/dist/src/renderer/components/SplitView'

  interface TabsProps {
    onTabDoubleClick?: (tabId: string) => void;
  }

  export interface ModalProps {
    title: React.ReactNode;
    isOpen: boolean;
    onClose: () => void;
    children: React.ReactNode;
  }

  export const Modal: React.ComponentType<ModalProps>;
}

