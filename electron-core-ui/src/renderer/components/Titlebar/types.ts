export interface TitlebarProps {
  icon?: string | React.ReactNode
  title: string
  leftContent?: React.ReactNode
  rightContent?: React.ReactNode
  centerContent?: React.ReactNode
  children?: React.ReactNode  // Deprecated: use leftContent instead
  className?: string
  id?: string
}
