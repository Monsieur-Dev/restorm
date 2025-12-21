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
  onBlur?: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => void
  onFocus?: () => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void
  disabled?: boolean
  className?: string
  id?: string
  style?: React.CSSProperties
  inputRef?: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>
}

export const defaultInputBoxStyles: IInputBoxStyles = {
  inputBackground: 'var(--input-background)',
  inputForeground: 'var(--input-foreground)',
  inputBorder: 'var(--input-border)',
  inputValidationInfoBorder: 'var(--inputValidation-infoBorder)',
  inputValidationInfoBackground: 'var(--inputValidation-infoBackground)',
  inputValidationInfoForeground: 'var(--inputValidation-infoForeground)',
  inputValidationWarningBorder: 'var(--inputValidation-warningBorder)',
  inputValidationWarningBackground: 'var(--inputValidation-warningBackground)',
  inputValidationWarningForeground: 'var(--inputValidation-warningForeground)',
  inputValidationErrorBorder: 'var(--inputValidation-errorBorder)',
  inputValidationErrorBackground: 'var(--inputValidation-errorBackground)',
  inputValidationErrorForeground: 'var(--inputValidation-errorForeground)'
}
