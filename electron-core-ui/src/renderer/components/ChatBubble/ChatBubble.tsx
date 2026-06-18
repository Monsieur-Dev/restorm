import React from 'react'
import './chatBubble.css'

/**
 * Which side of a conversation a bubble belongs to:
 * - `incoming` — a received message, aligned left (e.g. a tool response).
 * - `outgoing` — a sent message, aligned right (e.g. a request you made).
 */
export type ChatBubbleVariant = 'incoming' | 'outgoing'

export interface ChatBubbleProps {
  /** Incoming (left) vs outgoing (right). Drives alignment + tint. */
  variant: ChatBubbleVariant
  /** Bubble content. */
  children?: React.ReactNode
  /** Optional className appended to the bubble root. */
  className?: string
  /** Optional inline style overrides on the bubble root. */
  style?: React.CSSProperties
  /** Forwarded contextmenu handler (e.g. host "copy" menus). */
  onContextMenu?: React.MouseEventHandler<HTMLDivElement>
  /** Optional test id applied to the bubble root. */
  'data-testid'?: string
}

/**
 * A chat-style message bubble — the reusable incoming / outgoing speech bubble
 * used by conversation-like surfaces (the MCP logs viewer, etc.). Each variant
 * aligns to its side, squares off its near-bottom corner (the classic "tail"
 * corner), and tints from a theme variable:
 *
 * - incoming → `--chat-bubble-incoming-background`
 * - outgoing → `--chat-bubble-outgoing-background`
 *
 * Those variables are defined per theme (base + each theme family), so the
 * bubbles stay coherent across light / dark / high-contrast. The component
 * ships no copy and no layout width — the host owns sizing (max-width, etc.)
 * via `className` / `style`.
 */
export const ChatBubble: React.FC<ChatBubbleProps> = ({
  variant,
  children,
  className,
  style,
  onContextMenu,
  'data-testid': dataTestId
}) => {
  const classes = ['ecu-chat-bubble', `ecu-chat-bubble-${variant}`, className].filter(Boolean).join(' ')
  return (
    <div
      className={classes}
      style={style}
      data-variant={variant}
      {...(onContextMenu && { onContextMenu })}
      {...(dataTestId && { 'data-testid': dataTestId })}
    >
      {children}
    </div>
  )
}

export default ChatBubble
