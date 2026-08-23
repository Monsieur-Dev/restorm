// @vitest-environment jsdom
/**
 * Covers the release-notes modal:
 * - the reveal mechanism — `initialCount` sections up front, older ones one at a
 *   time via "show more", the button gone once everything is visible, and the
 *   count re-seeded on reopen;
 * - the loading / empty placeholders;
 * - image safety — only self-contained inline RASTER `data:` images render, and
 *   every form that would make the renderer fetch something is dropped.
 */
import { useState } from 'react'
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { ReleaseNotesModal, type ReleaseNoteSection } from './ReleaseNotesModal'

// jsdom has no layout engine, so the Modal's focus-trap visibility filter
// (`offsetParent`) always reads null; stub it non-null so the modal mounts and
// behaves like a laid-out window (same shim the Modal's own tests use). jsdom
// also ships no ResizeObserver, which the body's ScrollableElement constructs on
// mount — a no-op stub lets the tree render.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    get(): Element | null { return document.body },
    configurable: true
  })
  globalThis.ResizeObserver = class {
    observe(): void { /* no-op */ }
    unobserve(): void { /* no-op */ }
    disconnect(): void { /* no-op */ }
  } as unknown as typeof ResizeObserver
})

afterEach(() => { cleanup() })

const SECTIONS: ReleaseNoteSection[] = [
  { version: '3.0.0', markdown: '## v3.0.0\n\n- three' },
  { version: '2.0.0', markdown: '## v2.0.0\n\n- two' },
  { version: '1.0.0', markdown: '## v1.0.0\n\n- one' }
]

const ROOT = 'release-notes-modal'

describe('ReleaseNotesModal — reveal mechanism', () => {
  it('shows initialCount sections and reveals older ones one at a time', async () => {
    const { getByTestId, queryByTestId } = render(
      <ReleaseNotesModal isOpen onClose={vi.fn()} sections={SECTIONS} initialCount={1} />
    )
    await waitFor(() => getByTestId(ROOT))

    // Only the newest section is visible initially.
    expect(getByTestId(`${ROOT}-section-3.0.0`)).toBeTruthy()
    expect(queryByTestId(`${ROOT}-section-2.0.0`)).toBeNull()
    expect(queryByTestId(`${ROOT}-section-1.0.0`)).toBeNull()

    // First "show more" reveals exactly one more (the next older).
    fireEvent.click(getByTestId(`${ROOT}-show-more`))
    expect(getByTestId(`${ROOT}-section-2.0.0`)).toBeTruthy()
    expect(queryByTestId(`${ROOT}-section-1.0.0`)).toBeNull()

    // Second reveals the last one, and the button disappears (nothing left).
    fireEvent.click(getByTestId(`${ROOT}-show-more`))
    expect(getByTestId(`${ROOT}-section-1.0.0`)).toBeTruthy()
    expect(queryByTestId(`${ROOT}-show-more`)).toBeNull()
  })

  it('shows all sections and no button when initialCount is omitted', async () => {
    const { getByTestId, queryByTestId } = render(
      <ReleaseNotesModal isOpen onClose={vi.fn()} sections={SECTIONS} />
    )
    await waitFor(() => getByTestId(ROOT))

    expect(getByTestId(`${ROOT}-section-3.0.0`)).toBeTruthy()
    expect(getByTestId(`${ROOT}-section-2.0.0`)).toBeTruthy()
    expect(getByTestId(`${ROOT}-section-1.0.0`)).toBeTruthy()
    expect(queryByTestId(`${ROOT}-show-more`)).toBeNull()
  })

  it('never opens blank: clamps initialCount below 1 up to one section', async () => {
    const { getByTestId } = render(
      <ReleaseNotesModal isOpen onClose={vi.fn()} sections={SECTIONS} initialCount={0} />
    )
    await waitFor(() => getByTestId(ROOT))
    expect(getByTestId(`${ROOT}-section-3.0.0`)).toBeTruthy()
    // Older ones stay hidden behind "show more".
    expect(getByTestId(`${ROOT}-show-more`)).toBeTruthy()
  })

  it('shows the loading placeholder, not "empty", while the sections are pending', async () => {
    const { getByTestId, queryByTestId, rerender } = render(
      <ReleaseNotesModal isOpen onClose={vi.fn()} sections={[]} loading />
    )
    await waitFor(() => getByTestId(ROOT))
    expect(getByTestId(`${ROOT}-loading`)).toBeTruthy()
    expect(queryByTestId(`${ROOT}-empty`)).toBeNull()

    // Once the data lands, the placeholder gives way to the sections.
    rerender(<ReleaseNotesModal isOpen onClose={vi.fn()} sections={SECTIONS} loading={false} />)
    expect(queryByTestId(`${ROOT}-loading`)).toBeNull()
    expect(getByTestId(`${ROOT}-section-3.0.0`)).toBeTruthy()
  })

  it('renders the empty placeholder with no sections', async () => {
    const { getByTestId, queryByTestId } = render(
      <ReleaseNotesModal isOpen onClose={vi.fn()} sections={[]} />
    )
    await waitFor(() => getByTestId(ROOT))
    expect(getByTestId(`${ROOT}-empty`)).toBeTruthy()
    expect(queryByTestId(`${ROOT}-show-more`)).toBeNull()
  })

  it('re-seeds the reveal count on reopen', async () => {
    function Harness(): React.JSX.Element {
      const [open, setOpen] = useState(true)
      return (
        <>
          <button data-testid="toggle" onClick={() => { setOpen((o) => !o) }}>toggle</button>
          <ReleaseNotesModal isOpen={open} onClose={() => { setOpen(false) }} sections={SECTIONS} initialCount={1} />
        </>
      )
    }
    const { getByTestId, queryByTestId } = render(<Harness />)
    await waitFor(() => getByTestId(ROOT))

    // Expand everything, then close and reopen.
    fireEvent.click(getByTestId(`${ROOT}-show-more`))
    fireEvent.click(getByTestId(`${ROOT}-show-more`))
    expect(getByTestId(`${ROOT}-section-1.0.0`)).toBeTruthy()

    fireEvent.click(getByTestId('toggle')) // close
    fireEvent.click(getByTestId('toggle')) // reopen
    await waitFor(() => getByTestId(ROOT))

    // Back to just the newest section — the expansion did not persist.
    expect(getByTestId(`${ROOT}-section-3.0.0`)).toBeTruthy()
    expect(queryByTestId(`${ROOT}-section-2.0.0`)).toBeNull()
  })

  it('renders an inline data: URI image in a section (firewall-safe path)', async () => {
    // 1x1 transparent PNG — release-note images are authored as inline data:
    // URIs so the renderer never fetches a remote image the firewall would gate.
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    const { getByTestId } = render(
      <ReleaseNotesModal
        isOpen
        onClose={vi.fn()}
        sections={[{ version: '1.0.0', markdown: `## v1.0.0\n\n![logo](${png})` }]}
      />
    )
    await waitFor(() => getByTestId(ROOT))
    // Modal portals into document.body, so query there.
    const img = document.querySelector('img')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('src') ?? '').toMatch(/^data:image\/png/)
  })

  // Release notes must never make the renderer issue an outbound request: the
  // window may be firewalled or offline, and a remote image would hang or leak.
  // Every form below resolves to an image node further down the pipeline than a
  // scrub of the markdown text could reach, so each one is asserted separately.
  it.each([
    ['an inline remote image', '![shot](https://example.com/x.png)'],
    ['a full reference-style image', '![shot][s]\n\n[s]: https://evil.example/x.png'],
    ['a collapsed reference image', '![shot][]\n\n[shot]: https://evil.example/x.png'],
    ['a shortcut reference image', '![shot]\n\n[shot]: https://evil.example/x.png'],
    ['a raw <img> tag', '<img src="https://evil.example/x.png">'],
    ['a protocol-relative image', '![shot](//evil.example/x.png)'],
    ['a <picture> srcset', '<picture><source srcset="https://evil.example/x.png"><img src="https://evil.example/y.png"></picture>']
  ])('renders no fetchable image for %s', async (_label, markdown) => {
    const { getByTestId } = render(
      <ReleaseNotesModal
        isOpen
        onClose={vi.fn()}
        sections={[{ version: '1.0.0', markdown: `## v1.0.0\n\n${markdown}` }]}
      />
    )
    await waitFor(() => getByTestId(ROOT))
    expect(document.querySelector('img')).toBeNull()
    expect(document.querySelector('source')).toBeNull()
    // The version heading still rendered — only the image was dropped.
    expect(getByTestId(`${ROOT}-section-1.0.0`).textContent).toContain('v1.0.0')
  })

  // `rehypeRaw` lets raw HTML through, so any tag that loads a remote resource
  // by itself has to go too — otherwise "renders nothing fetchable" is only
  // approximately true.
  it.each([
    ['video', '<video src="https://evil.example/x.mp4" poster="https://evil.example/p.png"></video>'],
    ['audio', '<audio src="https://evil.example/x.mp3"></audio>'],
    ['iframe', '<iframe src="https://evil.example/x.html"></iframe>'],
    ['embed', '<embed src="https://evil.example/x.svg">'],
    ['object', '<object data="https://evil.example/x.svg"></object>'],
    ['track', '<video><track src="https://evil.example/x.vtt"></video>']
  ])('drops a resource-loading <%s>', async (tag, markdown) => {
    const { getByTestId } = render(
      <ReleaseNotesModal
        isOpen
        onClose={vi.fn()}
        sections={[{ version: '1.0.0', markdown: `## v1.0.0\n\n${markdown}` }]}
      />
    )
    await waitFor(() => getByTestId(ROOT))
    expect(document.querySelector(tag)).toBeNull()
  })

  it('strips srcset from a kept image (the browser prefers it over src)', async () => {
    const { getByTestId } = render(
      <ReleaseNotesModal
        isOpen
        onClose={vi.fn()}
        sections={[
          {
            version: '1.0.0',
            markdown:
              '## v1.0.0\n\n<img src="data:image/png;base64,AAAA" srcset="https://evil.example/x.png 2x">'
          }
        ]}
      />
    )
    await waitFor(() => getByTestId(ROOT))
    const img = document.querySelector('img')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('srcset')).toBeNull()
    expect(img?.getAttribute('src') ?? '').toMatch(/^data:image\/png/)
  })

  it('drops <input type="image"> but keeps a task-list checkbox', async () => {
    const { getByTestId } = render(
      <ReleaseNotesModal
        isOpen
        onClose={vi.fn()}
        sections={[
          {
            version: '1.0.0',
            markdown:
              '## v1.0.0\n\n<input type="image" src="https://evil.example/x.png">\n\n- [x] a done item\n- [ ] a pending item'
          }
        ]}
      />
    )
    await waitFor(() => getByTestId(ROOT))
    expect(document.querySelector('input[type="image"]')).toBeNull()
    // GFM task-list checkboxes are plain inputs and must survive.
    expect(document.querySelectorAll('input[type="checkbox"]').length).toBe(2)
  })

  it('drops an inline style that would fetch a background image', async () => {
    const { getByTestId } = render(
      <ReleaseNotesModal
        isOpen
        onClose={vi.fn()}
        sections={[
          {
            version: '1.0.0',
            markdown:
              '## v1.0.0\n\n<img src="data:image/png;base64,AAAA" style="background-image:url(https://evil.example/x.png)">'
          }
        ]}
      />
    )
    await waitFor(() => getByTestId(ROOT))
    const img = document.querySelector('img')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('style') ?? '').not.toContain('evil.example')
  })

  it('renders a non-base64 (percent-encoded) inline image', async () => {
    const gif = 'data:image/gif,%47%49%46%38%39%61'
    const { getByTestId } = render(
      <ReleaseNotesModal
        isOpen
        onClose={vi.fn()}
        sections={[{ version: '1.0.0', markdown: `## v1.0.0\n\n![x](${gif})` }]}
      />
    )
    await waitFor(() => getByTestId(ROOT))
    expect(document.querySelector('img')?.getAttribute('src')).toBe(gif)
  })

  it('drops a data: URI whose media type merely starts with an allowed one', async () => {
    const { getByTestId } = render(
      <ReleaseNotesModal
        isOpen
        onClose={vi.fn()}
        sections={[{ version: '1.0.0', markdown: '## v1.0.0\n\n![x](data:image/png-evil;base64,AAAA)' }]}
      />
    )
    await waitFor(() => getByTestId(ROOT))
    expect(document.querySelector('img')).toBeNull()
  })

  it('drops a data: URI that is not a raster image (no scripted SVG document)', async () => {
    const svg = 'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+'
    const { getByTestId } = render(
      <ReleaseNotesModal
        isOpen
        onClose={vi.fn()}
        sections={[
          {
            version: '1.0.0',
            markdown: `## v1.0.0\n\n![x](${svg})\n\n<object data="${svg}"></object>\n\n<embed src="${svg}">`
          }
        ]}
      />
    )
    await waitFor(() => getByTestId(ROOT))
    expect(document.querySelector('img')).toBeNull()
    // `data:` never reaches an element that would load it as a DOCUMENT.
    expect(document.querySelector('object[data^="data:"]')).toBeNull()
    expect(document.querySelector('embed[src^="data:"]')).toBeNull()
  })

  it('uses provided labels over the defaults', async () => {
    const { getByTestId, getByText } = render(
      <ReleaseNotesModal
        isOpen
        onClose={vi.fn()}
        sections={SECTIONS}
        initialCount={1}
        title="Nouveautés"
        revealMoreLabel="Voir plus"
      />
    )
    await waitFor(() => getByTestId(ROOT))
    expect(getByText('Nouveautés')).toBeTruthy()
    expect(getByText('Voir plus')).toBeTruthy()
  })
})
