/**
 * Component tests for `<EditableLabel>` (electron-core-ui).
 *
 * Lives in restorm/tests/unit/ because restorm already has React
 * Testing Library + jsdom wired up; electron-core-ui intentionally
 * has no RTL stack. Consuming ECU components from restorm tests is a
 * supported pattern (ECU is a dependency, not a consumer).
 */

import React, { useState } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
// Import directly from the EditableLabel source file rather than the
// electron-core-ui/renderer barrel — the barrel transitively pulls in
// `jsoncrack-react` via `JsonViewer`, and vite/vitest can't resolve
// that package's entry in jsdom even though it's React.lazy'd behind
// a Suspense boundary this test never renders.
import { EditableLabel, type EditableLabelAs } from '../../../electron-core-ui/src/renderer/components/EditableLabel'
import '@testing-library/jest-dom/vitest'

const noop = (): void => { /* intentionally empty */ }

/**
 * Return the interactive trigger button nested inside the root Tag. The
 * component renders interactive semantics on a nested `<button>` so the
 * polymorphic `as` tag keeps its native role (headings stay headings,
 * etc.) — tests have to click/focus the button, not the wrapper.
 */
function getTrigger(testId: string): HTMLElement {
  const root = screen.getByTestId(testId)
  return within(root).getByRole('button')
}

describe('EditableLabel', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('rendering in read mode', () => {
    it('renders as a span by default', () => {
      render(<EditableLabel value="hello" onChange={noop} data-testid="lbl" />)
      const root = screen.getByTestId('lbl')
      expect(root.tagName).toBe('SPAN')
      expect(root).toHaveTextContent('hello')
    })

    it.each<EditableLabelAs>(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'div'])(
      'respects as=%s',
      (as) => {
        render(<EditableLabel value="hello" onChange={noop} as={as} data-testid="lbl" />)
        expect(screen.getByTestId('lbl').tagName).toBe(as.toUpperCase())
      }
    )

    it('renders a nested <button> trigger when editable', () => {
      render(<EditableLabel value="hello" onChange={noop} data-testid="lbl" />)
      const root = screen.getByTestId('lbl')
      const trigger = within(root).getByRole('button')
      expect(trigger.tagName).toBe('BUTTON')
      expect(trigger.querySelector('.ecui-editable-label-pencil')).not.toBeNull()
    })

    it('preserves heading semantics when as="h2"', () => {
      render(<EditableLabel as="h2" value="hello" onChange={noop} data-testid="lbl" />)
      const heading = screen.getByRole('heading', { level: 2 })
      expect(heading).toBe(screen.getByTestId('lbl'))
      // The interactive role is on the inner button, not on the heading.
      expect(heading).not.toHaveAttribute('role', 'button')
    })

    it('omits the button + pencil when editable={false}', () => {
      render(
        <EditableLabel value="hello" onChange={noop} editable={false} data-testid="lbl" />
      )
      const root = screen.getByTestId('lbl')
      expect(within(root).queryByRole('button')).toBeNull()
      expect(root.querySelector('.ecui-editable-label-pencil')).toBeNull()
    })

    it('labels the trigger with "Edit <value>" by default', () => {
      render(<EditableLabel value="hello" onChange={noop} data-testid="lbl" />)
      expect(getTrigger('lbl')).toHaveAttribute('aria-label', 'Edit hello')
    })

    it('uses editTooltip for the trigger aria-label + pencil title when provided', () => {
      render(
        <EditableLabel value="hello" onChange={noop} editTooltip="Rename this thing" data-testid="lbl" />
      )
      const trigger = getTrigger('lbl')
      expect(trigger).toHaveAttribute('aria-label', 'Rename this thing')
      const pencil = trigger.querySelector('.ecui-editable-label-pencil')
      expect(pencil).toHaveAttribute('title', 'Rename this thing')
    })
  })

  describe('entering edit mode', () => {
    it('swaps to the input on click and pre-selects the text', async () => {
      const user = userEvent.setup()
      render(<EditableLabel value="hello" onChange={noop} data-testid="lbl" />)
      await user.click(getTrigger('lbl'))
      const input = screen.getByTestId('lbl-input')
      if (!(input instanceof HTMLInputElement)) throw new Error('expected HTMLInputElement')
      expect(input).toBeInTheDocument()
      expect(document.activeElement).toBe(input)
      expect(input.selectionStart).toBe(0)
      expect(input.selectionEnd).toBe('hello'.length)
    })

    it('enters edit mode on Enter when the trigger has focus (native button semantics)', async () => {
      const user = userEvent.setup()
      render(<EditableLabel value="hello" onChange={noop} data-testid="lbl" />)
      getTrigger('lbl').focus()
      await user.keyboard('{Enter}')
      expect(screen.getByTestId('lbl-input')).toBeInTheDocument()
    })

    it('does nothing on click when editable={false}', async () => {
      const user = userEvent.setup()
      render(
        <EditableLabel value="hello" onChange={noop} editable={false} data-testid="lbl" />
      )
      // Nothing interactive to click — just make sure no input appears
      // after clicking the root element.
      await user.click(screen.getByTestId('lbl'))
      expect(screen.queryByTestId('lbl-input')).not.toBeInTheDocument()
    })
  })

  describe('committing and cancelling', () => {
    it('commits the new value on Enter', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(<EditableLabel value="hello" onChange={onChange} data-testid="lbl" />)
      await user.click(getTrigger('lbl'))
      const input = screen.getByTestId('lbl-input')
      await user.clear(input)
      await user.type(input, 'world{Enter}')
      expect(onChange).toHaveBeenCalledExactlyOnceWith('world')
      expect(screen.queryByTestId('lbl-input')).not.toBeInTheDocument()
    })

    it('commits on blur', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(<EditableLabel value="hello" onChange={onChange} data-testid="lbl" />)
      await user.click(getTrigger('lbl'))
      const input = screen.getByTestId('lbl-input')
      await user.clear(input)
      await user.type(input, 'world')
      fireEvent.blur(input)
      expect(onChange).toHaveBeenCalledExactlyOnceWith('world')
    })

    it('cancels on Escape without calling onChange', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(<EditableLabel value="hello" onChange={onChange} data-testid="lbl" />)
      await user.click(getTrigger('lbl'))
      const input = screen.getByTestId('lbl-input')
      await user.clear(input)
      await user.type(input, 'world{Escape}')
      expect(onChange).not.toHaveBeenCalled()
      expect(screen.queryByTestId('lbl-input')).not.toBeInTheDocument()
      expect(screen.getByTestId('lbl')).toHaveTextContent('hello')
    })

    it('skips onChange when the value is unchanged', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(<EditableLabel value="hello" onChange={onChange} data-testid="lbl" />)
      await user.click(getTrigger('lbl'))
      await user.keyboard('{Enter}')
      expect(onChange).not.toHaveBeenCalled()
    })

    it('trims the committed value', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(<EditableLabel value="hello" onChange={onChange} data-testid="lbl" />)
      await user.click(getTrigger('lbl'))
      const input = screen.getByTestId('lbl-input')
      await user.clear(input)
      await user.type(input, '   padded   {Enter}')
      expect(onChange).toHaveBeenCalledExactlyOnceWith('padded')
    })

    it('resets the draft on successive edit sessions (cancel → re-enter)', async () => {
      const user = userEvent.setup()
      render(<EditableLabel value="hello" onChange={noop} data-testid="lbl" />)

      // First session: type something, cancel it.
      await user.click(getTrigger('lbl'))
      const firstInput = screen.getByTestId('lbl-input')
      if (!(firstInput instanceof HTMLInputElement)) throw new Error('expected HTMLInputElement')
      await user.clear(firstInput)
      await user.type(firstInput, 'discarded{Escape}')
      expect(screen.queryByTestId('lbl-input')).not.toBeInTheDocument()

      // Second session: the input should reset to the current value, not
      // the previously-typed-then-cancelled draft.
      await user.click(getTrigger('lbl'))
      const secondInput = screen.getByTestId('lbl-input')
      if (!(secondInput instanceof HTMLInputElement)) throw new Error('expected HTMLInputElement')
      expect(secondInput.value).toBe('hello')
    })

    it('restores focus to the trigger after commit', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(<EditableLabel value="hello" onChange={onChange} data-testid="lbl" />)
      await user.click(getTrigger('lbl'))
      const input = screen.getByTestId('lbl-input')
      await user.clear(input)
      await user.type(input, 'world{Enter}')
      // The trigger remounts on return to read mode — look it up freshly.
      expect(document.activeElement).toBe(getTrigger('lbl'))
    })

    it('restores focus to the trigger after cancel', async () => {
      const user = userEvent.setup()
      render(<EditableLabel value="hello" onChange={noop} data-testid="lbl" />)
      await user.click(getTrigger('lbl'))
      await user.keyboard('{Escape}')
      expect(document.activeElement).toBe(getTrigger('lbl'))
    })
  })

  describe('validate', () => {
    it('blocks the commit and renders the error', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const validate = (next: string): string | null =>
        next.length < 3 ? 'Too short' : null
      render(
        <EditableLabel value="hello" onChange={onChange} validate={validate} data-testid="lbl" />
      )
      await user.click(getTrigger('lbl'))
      const input = screen.getByTestId('lbl-input')
      await user.clear(input)
      await user.type(input, 'ab{Enter}')
      expect(onChange).not.toHaveBeenCalled()
      expect(screen.getByTestId('lbl-error')).toHaveTextContent('Too short')
      expect(input).toHaveAttribute('aria-invalid', 'true')
      // Still in edit mode
      expect(screen.getByTestId('lbl-input')).toBeInTheDocument()
    })

    it('accepts the commit when validate returns null', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const validate = (): null => null
      render(
        <EditableLabel value="hello" onChange={onChange} validate={validate} data-testid="lbl" />
      )
      await user.click(getTrigger('lbl'))
      const input = screen.getByTestId('lbl-input')
      await user.clear(input)
      await user.type(input, 'world{Enter}')
      expect(onChange).toHaveBeenCalledExactlyOnceWith('world')
    })

    it('treats undefined as acceptance', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const validate = (): undefined => undefined
      render(
        <EditableLabel value="hello" onChange={onChange} validate={validate} data-testid="lbl" />
      )
      await user.click(getTrigger('lbl'))
      const input = screen.getByTestId('lbl-input')
      await user.clear(input)
      await user.type(input, 'world{Enter}')
      expect(onChange).toHaveBeenCalledExactlyOnceWith('world')
    })
  })

  describe('controlled isEditing', () => {
    const ControlledHarness: React.FC<{ initial: boolean }> = ({ initial }) => {
      const [editing, setEditing] = useState(initial)
      return (
        <>
          <button type="button" data-testid="external-toggle" onClick={() => { setEditing((prev) => !prev) }}>toggle</button>
          <EditableLabel
            value="hello"
            onChange={noop}
            isEditing={editing}
            onEditingChange={setEditing}
            data-testid="lbl"
          />
        </>
      )
    }

    it('renders the input when the parent passes isEditing=true', () => {
      render(<ControlledHarness initial={true} />)
      expect(screen.getByTestId('lbl-input')).toBeInTheDocument()
    })

    it('fires onEditingChange when clicking the trigger to enter edit mode', async () => {
      const user = userEvent.setup()
      const onEditingChange = vi.fn()
      render(
        <EditableLabel
          value="hello"
          onChange={noop}
          isEditing={false}
          onEditingChange={onEditingChange}
          data-testid="lbl"
        />
      )
      await user.click(getTrigger('lbl'))
      expect(onEditingChange).toHaveBeenCalledWith(true)
    })

    it('parent state controls the mode', async () => {
      const user = userEvent.setup()
      render(<ControlledHarness initial={false} />)
      expect(screen.queryByTestId('lbl-input')).not.toBeInTheDocument()
      await user.click(screen.getByTestId('external-toggle'))
      expect(screen.getByTestId('lbl-input')).toBeInTheDocument()
    })

    it('parent-driven close mid-edit does not steal focus back to the trigger', () => {
      // Parent-flipped close without going through blur-commit: start
      // directly in edit mode via the controlled prop, then flip it
      // back to false programmatically. The component shouldn't grab
      // focus back to the trigger because no self-driven exit path
      // (commit / cancel / blur) ever ran.
      const ParentHarness: React.FC = () => {
        const [editing, setEditing] = useState(true)
        return (
          <>
            <button type="button" data-testid="external-close" onClick={() => { setEditing(false) }}>close</button>
            <EditableLabel
              value="hello"
              onChange={noop}
              isEditing={editing}
              onEditingChange={setEditing}
              data-testid="lbl"
            />
          </>
        )
      }
      render(<ParentHarness />)
      // We're in edit mode; focus is on the auto-focused input.
      expect(document.activeElement).toBe(screen.getByTestId('lbl-input'))
      // Use `fireEvent.click` (not `userEvent.click`) so the external
      // close flips the parent state WITHOUT moving focus first —
      // `userEvent` emulates a real pointer, which focuses the clicked
      // button and blurs the input on the way, triggering the
      // blur-commit path. We're specifically probing the pure
      // programmatic-close path here.
      fireEvent.click(screen.getByTestId('external-close'))
      // The trigger must NOT be the active element — the component
      // only restores focus on commit / cancel it drove itself.
      expect(document.activeElement).not.toBe(getTrigger('lbl'))
    })
  })

  describe('placeholder + maxLength + editTooltip', () => {
    it('forwards placeholder + maxLength to the input', async () => {
      const user = userEvent.setup()
      render(
        <EditableLabel
          value="hello"
          onChange={noop}
          placeholder="enter a name"
          maxLength={5}
          data-testid="lbl"
        />
      )
      await user.click(getTrigger('lbl'))
      const input = screen.getByTestId('lbl-input')
      if (!(input instanceof HTMLInputElement)) throw new Error('expected HTMLInputElement')
      expect(input.placeholder).toBe('enter a name')
      expect(input.maxLength).toBe(5)
    })

    it('passes editTooltip through as the pencil title', () => {
      render(
        <EditableLabel value="hello" onChange={noop} editTooltip="Rename" data-testid="lbl" />
      )
      const pencil = screen.getByTestId('lbl').querySelector('.ecui-editable-label-pencil')
      expect(pencil).toHaveAttribute('title', 'Rename')
    })
  })
})
