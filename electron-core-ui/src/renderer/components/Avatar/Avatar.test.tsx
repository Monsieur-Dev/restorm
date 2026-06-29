// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import Avatar from './Avatar'
import { deriveInitials } from './deriveInitials'

afterEach(() => { cleanup() })

const PNG = 'data:image/png;base64,iVBORw0KGgo='

describe('deriveInitials', () => {
  it('takes first + last token of a multi-word name', () => {
    expect(deriveInitials('Yoann Diguet')).toBe('YD')
  })

  it('derives from the local part of an email, splitting on separators', () => {
    expect(deriveInitials('jane.doe@acme.io')).toBe('JD')
    expect(deriveInitials('john_smith@x.io')).toBe('JS')
  })

  it('returns a single letter for a one-token name', () => {
    expect(deriveInitials('yoann')).toBe('Y')
  })

  it('falls back to "?" on empty input', () => {
    expect(deriveInitials('   ')).toBe('?')
  })
})

describe('Avatar', () => {
  it('renders derived initials when no image is given', () => {
    const { getByTestId } = render(<Avatar name="Yoann Diguet" data-testid="avatar" />)
    const root = getByTestId('avatar')
    expect(root.classList.contains('ecui-avatar--initials')).toBe(true)
    expect(root.textContent).toBe('YD')
  })

  it('honours an explicit initials override', () => {
    const { getByTestId } = render(<Avatar name="ignored@x.io" initials="ZZ" data-testid="avatar" />)
    expect(getByTestId('avatar').textContent).toBe('ZZ')
  })

  it('renders the image variant when imageUrl is set', () => {
    const { getByTestId } = render(<Avatar name="Jane" imageUrl={PNG} data-testid="avatar" />)
    const root = getByTestId('avatar')
    expect(root.classList.contains('ecui-avatar--image')).toBe(true)
    expect(root.querySelector('img')?.getAttribute('src')).toBe(PNG)
  })

  it('falls back to initials when the image fails to load', () => {
    const { getByTestId } = render(<Avatar name="Jane Doe" imageUrl="https://broken.example/x.png" data-testid="avatar" />)
    const root = getByTestId('avatar')
    const img = root.querySelector('img')
    if (!img) throw new Error('expected an <img> in the image variant')
    fireEvent.error(img)
    expect(getByTestId('avatar').classList.contains('ecui-avatar--initials')).toBe(true)
    expect(getByTestId('avatar').textContent).toBe('JD')
  })

  it('applies the size to width/height and scales the font', () => {
    const { getByTestId } = render(<Avatar name="Yoann" size={32} data-testid="avatar" />)
    const root = getByTestId('avatar')
    expect(root.style.width).toBe('32px')
    expect(root.style.height).toBe('32px')
  })
})
