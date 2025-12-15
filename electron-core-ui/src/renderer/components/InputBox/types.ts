export enum MessageType {
  INFO = 1,
  WARNING = 2,
  ERROR = 3
}

export interface IMessage {
  readonly content?: string
  readonly formatContent?: boolean
  readonly type?: MessageType
}

export type IInputValidator = (value: string) => IMessage | null

export interface IInputValidationOptions {
  validation?: IInputValidator
}

export interface IInputBoxStyles {
  readonly inputBackground: string | undefined
  readonly inputForeground: string | undefined
  readonly inputBorder: string | undefined
  readonly inputValidationInfoBorder: string | undefined
  readonly inputValidationInfoBackground: string | undefined
  readonly inputValidationInfoForeground: string | undefined
  readonly inputValidationWarningBorder: string | undefined
  readonly inputValidationWarningBackground: string | undefined
  readonly inputValidationWarningForeground: string | undefined
  readonly inputValidationErrorBorder: string | undefined
  readonly inputValidationErrorBackground: string | undefined
  readonly inputValidationErrorForeground: string | undefined
}

export interface IRange {
  start: number
  end: number
}

export interface IInputOptions {
  readonly placeholder?: string
  readonly showPlaceholderOnFocus?: boolean
  readonly tooltip?: string
  readonly ariaLabel?: string
  readonly type?: string
  readonly validationOptions?: IInputValidationOptions
  readonly flexibleHeight?: boolean
  readonly flexibleWidth?: boolean
  readonly flexibleMaxHeight?: number
  readonly inputBoxStyles?: IInputBoxStyles
}

export interface InputBoxProps {
  options: IInputOptions
  value?: string
  onChange?: (value: string) => void
  onBlur?: () => void
  onFocus?: () => void
  disabled?: boolean
  className?: string
  id?: string
  style?: React.CSSProperties
}

export const defaultInputBoxStyles: IInputBoxStyles = {
  inputBackground: 'var(--vscode-input-background)',
  inputForeground: 'var(--vscode-input-foreground)',
  inputBorder: 'var(--vscode-input-border)',
  inputValidationInfoBorder: 'var(--vscode-inputValidation-infoBorder)',
  inputValidationInfoBackground: 'var(--vscode-inputValidation-infoBackground)',
  inputValidationInfoForeground: 'var(--vscode-inputValidation-infoForeground)',
  inputValidationWarningBorder: 'var(--vscode-inputValidation-warningBorder)',
  inputValidationWarningBackground: 'var(--vscode-inputValidation-warningBackground)',
  inputValidationWarningForeground: 'var(--vscode-inputValidation-warningForeground)',
  inputValidationErrorBorder: 'var(--vscode-inputValidation-errorBorder)',
  inputValidationErrorBackground: 'var(--vscode-inputValidation-errorBackground)',
  inputValidationErrorForeground: 'var(--vscode-inputValidation-errorForeground)'
}
