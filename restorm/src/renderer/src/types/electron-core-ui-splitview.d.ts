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
}

