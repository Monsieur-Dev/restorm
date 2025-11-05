export interface IProgressBarStyles {
  readonly progressBarBackground?: string;
}

export interface IProgressBarOptions extends IProgressBarStyles {
  readonly progressBarBackground?: string;
}

export interface ProgressBarProps {
  options?: IProgressBarOptions;
  mode?: 'infinite' | 'discrete' | 'done';
  value?: number;
  total?: number;
  className?: string;
  id?: string;
  onComplete?: () => void;
}

export const defaultProgressBarStyles: IProgressBarStyles = {
  progressBarBackground: 'var(--vscode-progressBar-background, #0E70C0)'
};


