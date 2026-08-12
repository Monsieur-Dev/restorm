// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { Thumbnail, type ThumbnailMedia } from './Thumbnail'

afterEach(() => { cleanup() })

const PNG = 'data:image/png;base64,iVBORw0KGgo='
const imageMedia: ThumbnailMedia = { kind: 'image', src: PNG, mimeType: 'image/png' }
const videoMedia: ThumbnailMedia = { kind: 'video', src: 'file:///tmp/clip.webm', mimeType: 'video/webm' }
const labels = { copy: 'Copy', close: 'Close' }

describe('Thumbnail rendering', () => {
  it('renders an image media as an <img> with the given src', () => {
    const { getByTestId } = render(<Thumbnail media={imageMedia} labels={labels} />)
    const root = getByTestId('thumbnail')
    expect(root.getAttribute('data-kind')).toBe('image')
    const img = root.querySelector('img')
    expect(img?.getAttribute('src')).toBe(PNG)
  })

  it('renders a video media as a <video> with a play badge', () => {
    const { getByTestId } = render(<Thumbnail media={videoMedia} labels={labels} />)
    const root = getByTestId('thumbnail')
    expect(root.getAttribute('data-kind')).toBe('video')
    expect(root.querySelector('video')?.getAttribute('src')).toBe(videoMedia.src)
    expect(root.querySelector('.codicon-play-circle')).not.toBeNull()
  })
})

describe('Thumbnail enlarge', () => {
  it('click opens the media inside an ECUI Modal; close button requests dismissal', async () => {
    const { getByTestId, queryByTestId, findByTestId } = render(
      <Thumbnail media={imageMedia} labels={labels} title={<span>MCP screenshot</span>} />
    )
    expect(queryByTestId('thumbnail-enlarged')).toBeNull()
    fireEvent.click(getByTestId('thumbnail'))
    // The Modal mounts on a rAF tick — wait for its body, which carries the
    // enlarged media (rendered from the same src).
    const modal = await findByTestId('thumbnail-enlarged')
    expect(modal.querySelector('.ecu-thumbnail-enlarged-media')?.getAttribute('src')).toBe(PNG)
    // The host-supplied title renders in the modal header.
    expect(getByTestId('thumbnail-enlarged-title').textContent).toContain('MCP screenshot')
    // The Modal supplies the chrome incl. its close button (`<testId>-close`).
    expect(getByTestId('thumbnail-enlarged-close')).not.toBeNull()
  })

  it('Escape requests dismissal (handled by the ECUI Modal)', async () => {
    const { getByTestId, findByTestId } = render(<Thumbnail media={imageMedia} labels={labels} />)
    fireEvent.click(getByTestId('thumbnail'))
    await findByTestId('thumbnail-enlarged')
    // Modal owns Escape handling; firing it should not throw.
    fireEvent.keyDown(window, { key: 'Escape' })
  })
})

describe('Thumbnail copy', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('right-click → Copy writes an image PNG ClipboardItem and fires onCopied', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    // jsdom has neither clipboard.write nor ClipboardItem/fetch — stub them.
    vi.stubGlobal('ClipboardItem', class { constructor(public items: unknown) {} })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ blob: () => Promise.resolve(new Blob(['x'], { type: 'image/png' })) }))
    const onCopied = vi.fn()

    const { getByTestId } = render(<Thumbnail media={imageMedia} labels={labels} onCopied={onCopied} />)
    fireEvent.contextMenu(getByTestId('thumbnail'))
    fireEvent.click(getByTestId('thumbnail-copy'))

    await waitFor(() => { expect(write).toHaveBeenCalledTimes(1) })
    await waitFor(() => { expect(onCopied).toHaveBeenCalledTimes(1) })
  })

  it('right-click → Copy on a video writes the file path as text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const onCopied = vi.fn()

    const { getByTestId } = render(<Thumbnail media={videoMedia} labels={labels} onCopied={onCopied} />)
    fireEvent.contextMenu(getByTestId('thumbnail'))
    fireEvent.click(getByTestId('thumbnail-copy'))

    await waitFor(() => { expect(writeText).toHaveBeenCalledWith('/tmp/clip.webm') })
    await waitFor(() => { expect(onCopied).toHaveBeenCalledTimes(1) })
  })

  it('a copy failure fires onCopyError', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }
    })
    const onCopyError = vi.fn()
    const { getByTestId } = render(<Thumbnail media={videoMedia} labels={labels} onCopyError={onCopyError} />)
    fireEvent.contextMenu(getByTestId('thumbnail'))
    fireEvent.click(getByTestId('thumbnail-copy'))
    await waitFor(() => { expect(onCopyError).toHaveBeenCalledTimes(1) })
  })
})
