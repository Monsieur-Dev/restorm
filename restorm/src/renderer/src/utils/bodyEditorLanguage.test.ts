import { describe, it, expect } from 'vitest'
import { detectBodyEditorLanguage } from './bodyEditorLanguage'

describe('detectBodyEditorLanguage', () => {
  it.each([
    ['an element', '<pet><id>1</id></pet>'],
    ['a leading blank line', '\n  <pet/>'],
    ['a declaration', '<?xml version="1.0"?><pet/>'],
    ['a SOAP envelope', '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"/>']
  ])('reads %s as xml', (_label, body) => {
    expect(detectBodyEditorLanguage(body)).toBe('xml')
  })

  it.each([
    ['an object', '{"id": 1}'],
    ['an array', '[1, 2]'],
    ['a bare handlebars template', '{{payload}}'],
    ['plain text', 'hello'],
    ['an empty body', '']
  ])('reads %s as json', (_label, body) => {
    expect(detectBodyEditorLanguage(body)).toBe('json')
  })
})
