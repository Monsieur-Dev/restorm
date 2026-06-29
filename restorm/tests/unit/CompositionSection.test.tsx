import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

// Stub out the renderer barrel so the test loader does not have to resolve
// Monaco (pulled in transitively via ModelRefLink → Button → ECUI barrel).
// We only need Button to pass children through so model-name text is visible.
vi.mock('electron-core-ui/renderer', () => ({
  Button: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

import { CompositionSection } from '../../src/renderer/src/components/documentation/CompositionSection'
import type { ModelDocumentation } from '../../src/shared/types/apiDocumentation'

const plainModel: ModelDocumentation = {
  name: 'Plain',
  properties: [{ name: 'id', type: 'integer', required: true }]
}

const oneOfModel: ModelDocumentation = {
  name: 'Vehicle',
  properties: [],
  composition: { oneOf: ['Car', 'Boat'] }
}

const anyOfModel: ModelDocumentation = {
  name: 'Asset',
  properties: [],
  composition: { anyOf: ['Stock', 'Bond'] }
}

const discriminatorOnly: ModelDocumentation = {
  name: 'PetUntagged',
  properties: [],
  composition: { discriminator: { propertyName: 'petType' } }
}

const discriminatorWithMapping: ModelDocumentation = {
  name: 'Pet',
  properties: [],
  composition: { discriminator: { propertyName: 'petType', mapping: { dog: 'Dog', cat: 'Cat' } } }
}

describe('CompositionSection', () => {
  it('returns null when no model carries composition', () => {
    const { container } = render(<CompositionSection models={[plainModel]} />)
    expect(container.querySelector('[data-testid="documentation-host-composition"]')).toBeNull()
  })

  it('returns null on an empty models list', () => {
    const { container } = render(<CompositionSection models={[]} />)
    expect(container.querySelector('[data-testid="documentation-host-composition"]')).toBeNull()
  })

  it('renders the model name and a oneOf line', () => {
    const { getByText } = render(<CompositionSection models={[oneOfModel]} />)
    expect(getByText('oneOf')).toBeTruthy()
    expect(getByText('Car')).toBeTruthy()
    expect(getByText('Boat')).toBeTruthy()
  })

  it('renders an anyOf line', () => {
    const { getByText } = render(<CompositionSection models={[anyOfModel]} />)
    expect(getByText('anyOf')).toBeTruthy()
    expect(getByText('Stock')).toBeTruthy()
  })

  it('renders the discriminator property even without a mapping', () => {
    const { getByText, queryByText } = render(<CompositionSection models={[discriminatorOnly]} />)
    expect(getByText('discriminator')).toBeTruthy()
    expect(getByText('petType')).toBeTruthy()
    // No mapping — no `→` arrow.
    expect(queryByText('→')).toBeNull()
  })

  it('renders the full mapping table when discriminator carries one', () => {
    const { getByText, getAllByText } = render(<CompositionSection models={[discriminatorWithMapping]} />)
    expect(getByText('discriminator')).toBeTruthy()
    expect(getAllByText('→').length).toBe(2)
    expect(getByText('Dog')).toBeTruthy()
    expect(getByText('Cat')).toBeTruthy()
  })

  it('only lists models with a composition entry, skips plain ones', () => {
    const { container } = render(<CompositionSection models={[plainModel, oneOfModel]} />)
    const items = container.querySelectorAll('.documentation-host-composition__item')
    expect(items).toHaveLength(1)
  })
})
