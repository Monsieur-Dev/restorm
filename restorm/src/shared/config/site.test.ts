import { describe, it, expect } from 'vitest'
import { resolveChannel } from './backend'
import { siteBaseUrl, pricingUrl } from './site'

describe('site config', () => {
  it('points at the production site for a release channel', () => {
    expect(siteBaseUrl('prod')).toBe('https://restorm.app')
    expect(pricingUrl('prod')).toBe('https://restorm.app/pricing')
  })

  it('points at the dev Pages alias for the preview channel (distinct from prod)', () => {
    expect(siteBaseUrl('preview')).toBe('https://dev.restorm-website.pages.dev')
    expect(pricingUrl('preview')).toBe('https://dev.restorm-website.pages.dev/pricing')
    expect(siteBaseUrl('preview')).not.toBe(siteBaseUrl('prod'))
    // Both are absolute https URLs to a /pricing page.
    for (const url of [pricingUrl('preview'), pricingUrl('prod')]) {
      expect(url).toMatch(/^https:\/\/.+\/pricing$/)
    }
  })

  it('composes with resolveChannel so a -preview build gets the dev pricing page', () => {
    expect(pricingUrl(resolveChannel('0.1.12-preview'))).toBe(pricingUrl('preview'))
    expect(pricingUrl(resolveChannel('0.1.12'))).toBe(pricingUrl('prod'))
  })
})
