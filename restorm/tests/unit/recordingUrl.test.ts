import { describe, it, expect } from 'vitest'
import { isRecordableUrl } from '../../src/shared/recording/recordingUrl'

describe('isRecordableUrl — what the record button accepts', () => {
  it('accepts http(s) pages, localhost with a port, and local html pages', () => {
    expect(isRecordableUrl('https://example.com')).toBe(true)
    expect(isRecordableUrl('http://localhost:8080/')).toBe(true)
    expect(isRecordableUrl('  http://127.0.0.1:3000/app  ')).toBe(true)
    expect(isRecordableUrl('file:///home/dev/app/index.html')).toBe(true)
  })

  it('refuses everything else', () => {
    expect(isRecordableUrl('')).toBe(false)
    expect(isRecordableUrl('example.com')).toBe(false)
    expect(isRecordableUrl('javascript:alert(1)')).toBe(false)
    expect(isRecordableUrl('data:text/html,<b>x</b>')).toBe(false)
    expect(isRecordableUrl('http://')).toBe(false)
    expect(isRecordableUrl('file:///')).toBe(false)
  })
})
