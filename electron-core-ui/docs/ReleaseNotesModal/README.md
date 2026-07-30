# ReleaseNotesModal

A generic release-notes / changelog viewer modal for React applications.

## Overview

`ReleaseNotesModal` renders an ordered list of `{ version, markdown }` sections
(newest first) inside a scrollable [`Modal`](../Modal/README.md), and reveals the
older sections one at a time via a bottom "show more" button. It owns only the
layout and the reveal interaction — the consumer supplies the data (already
localized) and decides how many sections are "new" via `initialCount`.

Use it for two common shapes:

- **Before updating** — show every version between the target and the currently
  installed one; pass `initialCount` = the number of newer versions so the
  already-installed ones sit behind "show more".
- **After updating** — show the N most recent versions (`initialCount = N`), with
  "show more" to reach further back.

The modal does **no fetching of its own**. When the consumer *does* fetch (the
usual case — release notes for a version the running build does not bundle have
to come off the network), open the modal immediately and pass `loading` while the
request is in flight; waiting for the data before opening leaves the trigger
looking dead.

Each section's markdown is rendered with
[`MarkdownViewer`](../MarkdownViewer/README.md) in `inlineImagesOnly` mode: only
self-contained inline `data:` images are displayed, and any image the renderer
would have to **fetch** (`![](https://…)`, a reference-style image, a
`<picture><source srcset>`) is dropped rather than requested. Release notes are
often read in a firewalled or offline window, so this is enforced by the
component — the consumer does not have to scrub the markdown, and cannot opt out.

## Installation

```typescript
import { ReleaseNotesModal, type ReleaseNoteSection } from 'electron-core-ui/renderer'
```

## Component

### ReleaseNotesModal

#### Props

```typescript
export interface ReleaseNoteSection {
  /** Unique version label (used as the React key and in the per-section test id). */
  version: string
  /** Release-note markdown; only inline `data:` images render, remote ones are dropped. */
  markdown: string
}

export interface ReleaseNotesModalProps {
  /** When false, the modal is not rendered. */
  isOpen: boolean
  /** Requested close (Esc / the modal's close button). */
  onClose: () => void
  /** Sections ordered newest → oldest. */
  sections: ReleaseNoteSection[]
  /**
   * How many sections are visible initially (default: all). Clamped to
   * `[1, sections.length]` so the modal never opens blank with only a
   * "show more" button. Older sections are revealed one per click.
   */
  initialCount?: number
  /** Modal title. Defaults to the localized "What's new". */
  title?: React.ReactNode
  /** Reveal-more button label. Defaults to the localized "Show more". */
  revealMoreLabel?: React.ReactNode
  /**
   * The sections are still being resolved. Shows a loading placeholder instead
   * of the "nothing to show" empty state, so opening the modal before the data
   * arrives does not flash "no release notes". Ignored once `sections` is
   * non-empty.
   */
  loading?: boolean
  /** Body shown while `loading`. Defaults to a localized placeholder. */
  loadingLabel?: React.ReactNode
  /** Body shown when `sections` is empty. Defaults to a localized placeholder. */
  emptyLabel?: React.ReactNode
  /** Test id applied to the modal root. Defaults to `release-notes-modal`. */
  'data-testid'?: string
}
```

#### Localization

When `title`, `revealMoreLabel`, `loadingLabel`, or `emptyLabel` are omitted, the
component reads these `react-i18next` keys (shipped in the library's locales):

| Key                          | Default (en)                 |
| ---------------------------- | ---------------------------- |
| `releaseNotesModal.title`    | `What's new`                 |
| `releaseNotesModal.showMore` | `Show more`                  |
| `releaseNotesModal.loading`  | `Loading release notes…`     |
| `releaseNotesModal.empty`    | `No release notes to show.`  |

#### Usage

```tsx
import React, { useState } from 'react'
import { Button, ReleaseNotesModal, type ReleaseNoteSection } from 'electron-core-ui/renderer'

export const Example: React.FC = () => {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sections, setSections] = useState<ReleaseNoteSection[]>([])
  const [initialCount, setInitialCount] = useState(1)

  // Open FIRST, then fetch — otherwise the trigger looks dead while the
  // request is in flight.
  const show = async (): Promise<void> => {
    setSections([])
    setLoading(true)
    setOpen(true)
    try {
      const fetched = await loadReleaseNotes()
      setSections(fetched)
      // The versions newer than the running one show up front; the rest sit
      // behind "show more".
      setInitialCount(countNewerThanInstalled(fetched))
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button link onClick={() => { void show() }}>What&apos;s new</Button>
      <ReleaseNotesModal
        isOpen={open}
        onClose={() => { setOpen(false) }}
        sections={sections}
        initialCount={initialCount}
        loading={loading}
      />
    </>
  )
}
```

## Test ids

With a root test id of `release-notes-modal` (the default):

| Element                 | Test id                                   |
| ----------------------- | ----------------------------------------- |
| Modal root              | `release-notes-modal`                     |
| Scrollable body         | `release-notes-modal-scroll`              |
| A version section       | `release-notes-modal-section-<version>`   |
| A section's markdown     | `release-notes-modal-md-<version>`        |
| "Show more" button      | `release-notes-modal-show-more`           |
| Loading placeholder     | `release-notes-modal-loading`             |
| Empty placeholder       | `release-notes-modal-empty`               |

## Component location

- Source: `electron-core-ui/src/renderer/components/ReleaseNotesModal/ReleaseNotesModal.tsx`
- Styles: `electron-core-ui/src/renderer/components/ReleaseNotesModal/releaseNotesModal.css`
