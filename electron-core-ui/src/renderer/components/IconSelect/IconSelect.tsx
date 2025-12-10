import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Picker from '@emoji-mart/react'
import data from '@emoji-mart/data'
import type { Icon } from '../../../../types/icon'
import { Button } from '../Button'

import './iconSelect.css'

// List of commonly used codicons for the custom category
const CODICONS = [
  'account', 'activate-breakpoints', 'add', 'archive', 'arrow-both', 'arrow-down',
  'arrow-left', 'arrow-right', 'arrow-small-down', 'arrow-small-left', 'arrow-small-right',
  'arrow-small-up', 'arrow-up', 'beaker', 'bell', 'bell-dot', 'bold', 'book', 'bookmark',
  'briefcase', 'broadcast', 'browser', 'bug', 'calendar', 'call-incoming', 'call-outgoing',
  'case-sensitive', 'check', 'check-all', 'checklist', 'chevron-down', 'chevron-left',
  'chevron-right', 'chevron-up', 'chrome-close', 'chrome-maximize', 'chrome-minimize',
  'chrome-restore', 'circle-filled', 'circle-outline', 'circle-slash', 'circuit-board',
  'clear-all', 'clippy', 'clock', 'clone', 'close', 'close-all', 'cloud', 'cloud-download',
  'cloud-upload', 'code', 'collapse-all', 'color-mode', 'combine', 'comment',
  'comment-discussion', 'compass', 'console', 'copy', 'credit-card', 'dash', 'dashboard',
  'database', 'debug', 'debug-alt', 'debug-breakpoint', 'debug-console', 'debug-continue',
  'debug-disconnect', 'debug-pause', 'debug-restart', 'debug-start', 'debug-step-into',
  'debug-step-out', 'debug-step-over', 'debug-stop', 'desktop-download', 'device-camera',
  'device-camera-video', 'device-mobile', 'diff', 'diff-added', 'diff-ignored',
  'diff-modified', 'diff-removed', 'diff-renamed', 'discard', 'edit', 'editor-layout',
  'ellipsis', 'empty-window', 'error', 'exclude', 'expand-all', 'export', 'extensions',
  'eye', 'eye-closed', 'feedback', 'file', 'file-add', 'file-binary', 'file-code',
  'file-media', 'file-pdf', 'file-submodule', 'file-symlink-directory', 'file-symlink-file',
  'file-zip', 'files', 'filter', 'flame', 'fold', 'fold-down', 'fold-up', 'folder',
  'folder-active', 'folder-library', 'folder-opened', 'gear', 'gift', 'gist', 'gist-secret',
  'git-branch', 'git-commit', 'git-compare', 'git-merge', 'git-pull-request', 'github',
  'github-action', 'github-alt', 'github-inverted', 'globe', 'go-to-file', 'grabber',
  'graph', 'graph-left', 'gripper', 'group-by-ref-type', 'heart', 'history', 'home',
  'horizontal-rule', 'hubot', 'inbox', 'info', 'inspect', 'issue-closed', 'issue-opened',
  'issue-reopened', 'issues', 'italic', 'jersey', 'json', 'kebab-vertical', 'key',
  'keyboard', 'law', 'layers', 'layers-active', 'layers-dot', 'layout', 'library',
  'lightbulb', 'lightbulb-autofix', 'link', 'link-external', 'list-filter', 'list-flat',
  'list-ordered', 'list-selection', 'list-tree', 'list-unordered', 'live-share',
  'loading', 'location', 'lock', 'mail', 'mail-read', 'map', 'markdown', 'megaphone',
  'mention', 'menu', 'merge', 'milestone', 'mirror', 'mortar-board', 'move', 'multiple-windows',
  'mute', 'new-file', 'new-folder', 'newline', 'no-newline', 'note', 'notebook',
  'notebook-template', 'octoface', 'open-preview', 'organization', 'outline', 'output',
  'package', 'paintcan', 'pass', 'pass-filled', 'person', 'person-add', 'pie-chart',
  'pin', 'pinned', 'pinned-dirty', 'play', 'play-circle', 'plug', 'preserve-case',
  'preview', 'primitive-square', 'project', 'pulse', 'question', 'quote', 'radio-tower',
  'reactions', 'record', 'record-keys', 'redo', 'references', 'refresh', 'regex',
  'remote', 'remote-explorer', 'remove', 'remove-close', 'repl', 'replace', 'replace-all',
  'reply', 'repo', 'repo-clone', 'repo-forked', 'repo-pull', 'repo-push', 'report',
  'request-changes', 'robot', 'rocket', 'root-folder', 'root-folder-opened', 'rss',
  'ruby', 'run', 'run-above', 'run-all', 'run-below', 'run-errors', 'save', 'save-all',
  'save-as', 'screen-full', 'screen-normal', 'search', 'search-save', 'search-stop',
  'selection', 'send', 'server', 'server-environment', 'server-process', 'settings',
  'settings-gear', 'shield', 'sign-in', 'sign-out', 'smiley', 'snake', 'sort-precedence',
  'source-control', 'split-horizontal', 'split-vertical', 'squirrel', 'star', 'star-add',
  'star-delete', 'star-empty', 'star-full', 'star-half', 'stop', 'stop-circle',
  'symbol-array', 'symbol-boolean', 'symbol-class', 'symbol-color', 'symbol-constant',
  'symbol-enum', 'symbol-enum-member', 'symbol-event', 'symbol-field', 'symbol-file',
  'symbol-interface', 'symbol-key', 'symbol-keyword', 'symbol-method', 'symbol-misc',
  'symbol-namespace', 'symbol-numeric', 'symbol-operator', 'symbol-parameter',
  'symbol-property', 'symbol-ruler', 'symbol-snippet', 'symbol-string', 'symbol-structure',
  'symbol-variable', 'sync', 'sync-ignored', 'tab', 'tag', 'target', 'tasklist',
  'telescope', 'terminal', 'terminal-bash', 'terminal-cmd', 'terminal-debian',
  'terminal-linux', 'terminal-powershell', 'terminal-tmux', 'terminal-ubuntu', 'text-size',
  'three-bars', 'thumbsdown', 'thumbsup', 'tools', 'trash', 'trashcan', 'triangle-down',
  'triangle-left', 'triangle-right', 'triangle-up', 'twitter', 'type-hierarchy',
  'type-hierarchy-sub', 'type-hierarchy-super', 'unfold', 'ungroup-by-ref-type', 'unlock',
  'unmute', 'unverified', 'variable', 'variable-group', 'verified', 'verified-filled',
  'versions', 'vm', 'vm-active', 'vm-connect', 'vm-outline', 'vm-running', 'wand',
  'warning', 'watch', 'whitespace', 'whole-word', 'window', 'word-wrap', 'workspace-trusted',
  'workspace-unknown', 'workspace-untrusted', 'zoom-in', 'zoom-out'
]

export interface IconSelectProps {
  /** Currently selected icon */
  value?: Icon | null
  /** Called when the icon selection changes */
  onChange?: (icon: Icon | null) => void
  /** Placeholder shown when no icon is selected */
  placeholder?: string
  /** Whether the picker is disabled */
  disabled?: boolean
  className?: string
  style?: React.CSSProperties
}

interface EmojiData {
  native: string
  id: string
  shortcodes?: string
}

/**
 * Detect if the current theme is dark based on data-theme attribute
 */
function isDarkTheme(): boolean {
  if (typeof document === 'undefined') return true
  const themeAttr = document.documentElement.getAttribute('data-theme') ?? 'dark'
  return themeAttr === 'dark' || themeAttr === 'hcDark' || themeAttr === 'hc'
}

export const IconSelect: React.FC<IconSelectProps> = ({
  value,
  onChange,
  placeholder = '🔲',
  disabled = false,
  className,
  style
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => isDarkTheme() ? 'dark' : 'light')
  const containerRef = useRef<HTMLDivElement | null>(null)
  const pickerRef = useRef<HTMLDivElement | null>(null)

  // Watch for theme changes
  useEffect(() => {
    if (typeof document === 'undefined') return

    const handleThemeChange = (): void => {
      setTheme(isDarkTheme() ? 'dark' : 'light')
    }

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' && m.attributeName === 'data-theme') {
          handleThemeChange()
        }
      }
    })

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    })

    return () => {
      observer.disconnect()
    }
  }, [])

  // Close picker when clicking outside
  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (event: MouseEvent): void => {
      const target = event.target as Node
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        pickerRef.current &&
        !pickerRef.current.contains(target)
      ) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const handleEmojiSelect = useCallback((emojiData: EmojiData) => {
    onChange?.({
      type: 'emoji',
      value: emojiData.native
    })
    setIsOpen(false)
  }, [onChange])

  const handleCodiconSelect = useCallback((codiconName: string) => {
    onChange?.({
      type: 'codicon',
      value: codiconName
    })
    setIsOpen(false)
  }, [onChange])

  const handleClear = useCallback(() => {
    onChange?.(null)
    setIsOpen(false)
  }, [onChange])

  // Build custom category for codicons
  const customCategory = useMemo(() => [{
    id: 'codicons',
    name: 'Codicons',
    emojis: CODICONS.map(name => ({
      id: `codicon-${name}`,
      name: name,
      keywords: [name, 'codicon', 'icon'],
      skins: [{ native: name }]
    }))
  }], [])

  const displayValue = useMemo(() => {
    if (!value || value.type === 'none') {
      return placeholder
    }
    if (value.type === 'emoji') {
      return value.value
    }
    // Codicon: render as icon
    return <i className={`codicon codicon-${value.value}`} />
  }, [value, placeholder])

  const rootClassName = useMemo(
    () => ['ecui-icon-select', className].filter(Boolean).join(' '),
    [className]
  )

  return (
    <div ref={containerRef} className={rootClassName} style={style}>
      <button
        type="button"
        className="ecui-icon-select-button"
        disabled={disabled}
        onClick={() => { setIsOpen(!isOpen) }}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      >
        <span className="ecui-icon-select-value">{displayValue}</span>
      </button>

      {isOpen && (
        <div ref={pickerRef} className="ecui-icon-select-picker">
          <div className="ecui-icon-select-actions">
            <Button small secondary onClick={handleClear}>
              <i className="codicon codicon-close" /> Clear
            </Button>
          </div>
          
          <Picker
            data={data}
            onEmojiSelect={handleEmojiSelect}
            theme={theme}
            previewPosition="none"
            skinTonePosition="none"
            custom={customCategory}
            categories={['frequent', 'people', 'nature', 'foods', 'activity', 'places', 'objects', 'symbols', 'flags', 'codicons']}
            onClickOutside={() => { setIsOpen(false) }}
            emojiButtonColors={[]}
          />
          
          {/* Custom codicons section */}
          <div className="ecui-icon-select-codicons">
            <div className="ecui-icon-select-codicons-header">Codicons</div>
            <div className="ecui-icon-select-codicons-grid">
              {CODICONS.map(name => (
                <button
                  key={name}
                  type="button"
                  className="ecui-icon-select-codicon"
                  title={name}
                  onClick={() => { handleCodiconSelect(name) }}
                >
                  <i className={`codicon codicon-${name}`} />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default IconSelect

