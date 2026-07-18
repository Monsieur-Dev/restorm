/**
 * Component tests for `<RegistryBadge>` — the single declarative badge pill.
 * Rendering is driven entirely by `badgeRegistry.json`, so these assert the
 * structural contract every surface relies on: the `data-badge-id` hook, the
 * registry label, the action codicon, the SRV server capsule, and the
 * `http_other` fallback for an unknown id.
 */

import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { RegistryBadge } from '../../src/renderer/src/components/common/RegistryBadge'
import '@testing-library/jest-dom/vitest'

describe('RegistryBadge', () => {
  it('renders a base method badge: registry label + data-badge-id, no capsule', () => {
    const { container } = render(<RegistryBadge badgeId="http_get" />)
    const badge = container.querySelector('.registry-badge')
    expect(badge).toHaveAttribute('data-badge-id', 'http_get')
    expect(badge).toHaveTextContent('GET')
    expect(container.querySelector('.badge-capsule')).toBeNull()
  })

  it('a custom text overrides the registry label (verbatim HTTP verb casing)', () => {
    const { container } = render(<RegistryBadge badgeId="http_other" text="Frobnicate" />)
    const badge = container.querySelector('.registry-badge')
    expect(badge).toHaveAttribute('data-badge-id', 'http_other')
    expect(badge).toHaveTextContent('Frobnicate')
  })

  it('an action badge renders the registry codicon before the label', () => {
    const { container } = render(<RegistryBadge badgeId="ws_send" />)
    const badge = container.querySelector('.registry-badge')
    expect(badge).toHaveTextContent('WS')
    expect(badge?.querySelector('i.codicon.codicon-arrow-up')).not.toBeNull()
  })

  it('an icon-only badge (auth) renders the codicon and no text', () => {
    const { container } = render(<RegistryBadge badgeId="auth" />)
    const badge = container.querySelector('.registry-badge')
    expect(badge).toHaveTextContent('')
    expect(badge?.querySelector('i.codicon.codicon-key')).not.toBeNull()
  })

  it('a fixed-protocol server entry renders the SRV capsule around the body', () => {
    const { container } = render(<RegistryBadge badgeId="ws_server" />)
    const capsule = container.querySelector('.badge-capsule')
    expect(capsule).not.toBeNull()
    expect(capsule?.querySelector('.badge-capsule-glyph')).toHaveTextContent('SRV')
    const body = capsule?.querySelector('.registry-badge')
    expect(body).toHaveAttribute('data-badge-id', 'ws_server')
    expect(body).toHaveTextContent('WS')
    // Server capsules carry no action glyph.
    expect(body?.querySelector('i.codicon')).toBeNull()
  })

  it('the caller-driven server prop wraps a method entry in the capsule (HTTP mock server)', () => {
    const { container } = render(<RegistryBadge badgeId="http_get" text="POST" server />)
    const capsule = container.querySelector('.badge-capsule')
    expect(capsule?.querySelector('.badge-capsule-glyph')).toHaveTextContent('SRV')
    expect(capsule?.querySelector('.registry-badge')).toHaveTextContent('POST')
  })

  it('an unknown id falls back to the neutral http_other styling', () => {
    const { container } = render(<RegistryBadge badgeId="does_not_exist" text="???" />)
    const badge = container.querySelector('.registry-badge')
    // The fallback entry is http_other; the caller text still renders and the
    // neutral background token is applied inline.
    expect(badge).toHaveTextContent('???')
    expect(badge?.getAttribute('style')).toContain('--badge-other-background')
  })
})
