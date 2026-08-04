import { describe, it, expect } from 'vitest'
import { resolveChannel } from './backend'
import { siteBaseUrl, pricingUrl, siteLocalePath, websiteUrl, docsUrl, releaseNotesUrl } from './site'

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

  describe('locale-aware site links', () => {
    it('leaves French unprefixed (the site serves it at the root)', () => {
      expect(siteLocalePath('fr')).toBe('')
      expect(websiteUrl('prod', 'fr')).toBe('https://restorm.app')
      expect(docsUrl('prod', 'fr')).toBe('https://restorm.app/docs')
      expect(releaseNotesUrl('prod', 'fr')).toBe('https://restorm.app/changelog')
    })

    it('prefixes every other shipped language with its site path', () => {
      expect(siteLocalePath('en')).toBe('/en')
      expect(docsUrl('prod', 'en')).toBe('https://restorm.app/en/docs')
      expect(docsUrl('prod', 'ja')).toBe('https://restorm.app/ja/docs')
      expect(releaseNotesUrl('prod', 'de')).toBe('https://restorm.app/de/changelog')
      expect(websiteUrl('prod', 'ko')).toBe('https://restorm.app/ko')
    })

    it('lowercases the regional Chinese codes to match the site paths', () => {
      expect(siteLocalePath('zh-CN')).toBe('/zh-cn')
      expect(siteLocalePath('zh-TW')).toBe('/zh-tw')
      expect(docsUrl('prod', 'zh-CN')).toBe('https://restorm.app/zh-cn/docs')
    })

    it('falls back to the unprefixed root for a language the site does not publish', () => {
      expect(siteLocalePath('xx')).toBe('')
      expect(siteLocalePath('en-US')).toBe('')
      expect(docsUrl('prod', 'xx')).toBe('https://restorm.app/docs')
    })

    it('honours the preview channel for every link', () => {
      expect(docsUrl('preview', 'en')).toBe('https://dev.restorm-website.pages.dev/en/docs')
      expect(releaseNotesUrl('preview', 'fr')).toBe('https://dev.restorm-website.pages.dev/changelog')
    })
  })
})
