// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { PushModal } from './PushModal'

// i18n is mocked to echo the key so assertions don't depend on a loaded bundle.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

afterEach(() => { cleanup() })

const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'Français' }
]

const LANGUAGES_WITH_FLAGS = [
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' }
]

function renderPushModal(overrides: Partial<React.ComponentProps<typeof PushModal>> = {}): {
  onClose: ReturnType<typeof vi.fn>
  onLanguageChange: ReturnType<typeof vi.fn>
  onApplyLanguageByDefaultChange: ReturnType<typeof vi.fn>
  onTitleChange: ReturnType<typeof vi.fn>
  onBodyChange: ReturnType<typeof vi.fn>
  onPush: ReturnType<typeof vi.fn>
} {
  const onClose = vi.fn()
  const onLanguageChange = vi.fn()
  const onApplyLanguageByDefaultChange = vi.fn()
  const onTitleChange = vi.fn()
  const onBodyChange = vi.fn()
  const onPush = vi.fn()

  render(
    <PushModal
      isOpen
      onClose={onClose}
      languages={LANGUAGES}
      language="en"
      onLanguageChange={onLanguageChange}
      applyLanguageByDefault
      onApplyLanguageByDefaultChange={onApplyLanguageByDefaultChange}
      title="Update to the request &quot;Find pet by ID&quot;"
      onTitleChange={onTitleChange}
      body="Modified the request &quot;Find pet by ID&quot;"
      onBodyChange={onBodyChange}
      onPush={onPush}
      {...overrides}
    />
  )

  return { onClose, onLanguageChange, onApplyLanguageByDefaultChange, onTitleChange, onBodyChange, onPush }
}

describe('PushModal', () => {
  it('renders the language select, title/body fields, and Cancel/Push buttons', () => {
    renderPushModal()
    expect(screen.getByTestId('push-modal-language-select')).toBeTruthy()
    expect(screen.getByTestId('push-modal-title-input')).toBeTruthy()
    expect(screen.getByTestId('push-modal-body-input')).toBeTruthy()
    expect(screen.getByTestId('push-modal-apply-default-toggle')).toBeTruthy()
    expect(screen.getByTestId('push-modal-cancel-button')).toBeTruthy()
    expect(screen.getByTestId('push-modal-push-button')).toBeTruthy()
  })

  it('prefills the title and body fields from props (the host-generated summary)', () => {
    renderPushModal({ title: 'Update to 3 requests, 1 scenario', body: 'line one\nline two' })
    // InputBox's own convention: `data-testid` lands on a hidden state
    // sentinel; the real <input>/<textarea> suffixes it with `-input`.
    const titleInput = screen.getByTestId<HTMLInputElement>('push-modal-title-input-input')
    const bodyInput = screen.getByTestId<HTMLTextAreaElement>('push-modal-body-input-input')
    expect(titleInput.value).toBe('Update to 3 requests, 1 scenario')
    expect(bodyInput.value).toBe('line one\nline two')
  })

  it('clicking Cancel calls onClose; clicking Push calls onPush', () => {
    const { onClose, onPush } = renderPushModal()
    fireEvent.click(screen.getByTestId('push-modal-cancel-button'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onPush).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('push-modal-push-button'))
    expect(onPush).toHaveBeenCalledTimes(1)
  })

  it('toggling "apply language by default" reports the new value', () => {
    const { onApplyLanguageByDefaultChange } = renderPushModal({ applyLanguageByDefault: true })
    // Toggle's own convention: the plain `data-testid` lands on a
    // non-interactive wrapper; the clickable checkbox suffixes `-action`.
    fireEvent.click(screen.getByTestId('push-modal-apply-default-toggle-action'))
    expect(onApplyLanguageByDefaultChange).toHaveBeenCalledWith(false)
  })

  it('shows the title counter under the soft limit without a warning color', () => {
    renderPushModal({ title: 'short title' })
    const counter = screen.getByTestId('push-modal-title-counter')
    expect(counter.textContent).toBe('11/72')
    expect(counter.style.color).toBe('')
  })

  it('shows the title counter in a warning color at the 72-char soft limit (no hard block)', () => {
    const longTitle = 'x'.repeat(72)
    const { onTitleChange } = renderPushModal({ title: longTitle })
    const counter = screen.getByTestId('push-modal-title-counter')
    expect(counter.textContent).toBe('72/72')
    expect(counter.style.color).not.toBe('')

    // The field itself is never blocked from growing past the limit.
    const titleInput = screen.getByTestId<HTMLInputElement>('push-modal-title-input-input')
    fireEvent.change(titleInput, { target: { value: `${longTitle}y` } })
    expect(onTitleChange).toHaveBeenCalledWith(`${longTitle}y`)
  })

  it('respects a custom titleSoftLimit', () => {
    renderPushModal({ title: 'abcdefghij', titleSoftLimit: 10 })
    expect(screen.getByTestId('push-modal-title-counter').textContent).toBe('10/10')
  })

  it('does not render when isOpen is false', () => {
    renderPushModal({ isOpen: false })
    expect(screen.queryByTestId('push-modal')).toBeNull()
  })

  it('supports a custom data-testid root', () => {
    renderPushModal({ 'data-testid': 'custom-push' })
    expect(screen.getByTestId('custom-push')).toBeTruthy()
    expect(screen.getByTestId('custom-push-push-button')).toBeTruthy()
  })

  it('renders each language option as "{flag} {name}" via the shared formatter, when flags are provided', () => {
    renderPushModal({ languages: LANGUAGES_WITH_FLAGS })
    const trigger = screen.getByTestId('push-modal-language-select-trigger')
    expect(trigger.textContent).toContain('🇬🇧 English')
  })

  it('renders the language name alone when a language entry has no flag', () => {
    renderPushModal({ languages: LANGUAGES })
    const trigger = screen.getByTestId('push-modal-language-select-trigger')
    expect(trigger.textContent).toBe('English')
  })
})
