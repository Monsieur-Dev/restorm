import 'electron-core-ui/renderer';

declare module 'electron-core-ui/renderer' {
  interface SplitViewPaneProps {
    collapsed?: boolean;
  }
}
