import React, { useState } from 'react'
import {
  Button,
  toasterService,
  useToasts
} from 'electron-core-ui/renderer'

const DEMO_TOASTER_ID = 'demo'

const ToasterTab: React.FC = () => {

  const {
    pushToast,
    setDoNotDisturb,
    setShowFrame,
    doNotDisturb,
    showFrame
  } = useToasts(DEMO_TOASTER_ID)

  const [title, setTitle] = useState('Hello')
  const [body, setBody] = useState('This is a notification.')
  const [duration, setDuration] = useState('5000')

  const handleManualPush = (): void => {
    const durationMs = duration.trim() === '' ? undefined : Number(duration)
    const input: Parameters<typeof pushToast>[0] = { title, body }
    if (durationMs !== undefined && Number.isFinite(durationMs)) {
      input.durationMs = durationMs
    }
    pushToast(input)
  }

  const handleUpdateInPlace = (): void => {
    const steps = ['Uploading…', '33%', '66%', 'Done!']
    let i = 0
    const tick = (): void => {
      const step = steps[i] ?? 'Done!'
      pushToast({
        id: 'upload',
        title: 'Upload',
        body: step,
        durationMs: i === steps.length - 1 ? 4000 : undefined
      })
      i += 1
      if (i < steps.length) window.setTimeout(tick, 600)
    }
    tick()
  }

  const handleLongBody = (): void => {
    pushToast({
      title: 'A really, really, really, really, really long title that overflows',
      body: 'Body content spanning multiple lines — lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
      durationMs: 10000
    })
  }

  const handleBurst = (): void => {
    for (let i = 0; i < 5; i += 1) {
      pushToast({
        title: `Toast #${i + 1}`,
        body: `Message number ${i + 1}`,
        durationMs: 4000 + i * 500
      })
    }
  }

  return (
    <div
      data-testid="toaster-tab"
      style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}
    >
      <div data-testid="toaster-ready">true</div>
      <h2 style={{ margin: 0 }}>Toaster</h2>
      <p style={{ margin: 0, color: 'var(--descriptionForeground)' }}>
        Toasts are pushed to the global <code>&lt;Toaster id=&quot;demo&quot;&gt;</code> at the bottom-right of the window.
      </p>

      <fieldset style={{ border: '1px solid var(--panel-border)', padding: 12, borderRadius: 3 }}>
        <legend>Manual push</legend>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ width: 80 }}>Title</span>
            <input
              data-testid="toaster-input-title"
              value={title}
              onChange={(e) => { setTitle(e.target.value) }}
              style={{ flex: 1, padding: '4px 6px' }}
            />
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ width: 80 }}>Body</span>
            <input
              data-testid="toaster-input-body"
              value={body}
              onChange={(e) => { setBody(e.target.value) }}
              style={{ flex: 1, padding: '4px 6px' }}
            />
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ width: 80 }}>Duration</span>
            <input
              data-testid="toaster-input-duration"
              value={duration}
              onChange={(e) => { setDuration(e.target.value) }}
              placeholder="ms (empty = indefinite)"
              style={{ flex: 1, padding: '4px 6px' }}
            />
          </label>
          <div>
            <Button data-testid="toaster-push" onClick={handleManualPush}>Push</Button>
          </div>
        </div>
      </fieldset>

      <fieldset style={{ border: '1px solid var(--panel-border)', padding: 12, borderRadius: 3 }}>
        <legend>Presets</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Button data-testid="toaster-preset-update" onClick={handleUpdateInPlace}>Update in place</Button>
          <Button data-testid="toaster-preset-long" onClick={handleLongBody}>Long title/body</Button>
          <Button data-testid="toaster-preset-burst" onClick={handleBurst}>Burst of 5</Button>
        </div>
      </fieldset>

      <fieldset style={{ border: '1px solid var(--panel-border)', padding: 12, borderRadius: 3 }}>
        <legend>Controls</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <Button
            data-testid="toaster-toggle-frame"
            secondary
            onClick={() => { setShowFrame(!showFrame) }}
          >
            {showFrame ? 'Hide frame' : 'Show frame'}
          </Button>
          <Button
            data-testid="toaster-toggle-dnd"
            secondary
            onClick={() => { setDoNotDisturb(!doNotDisturb) }}
          >
            {doNotDisturb ? 'Disable DND' : 'Enable DND'}
          </Button>
          <Button
            data-testid="toaster-clear"
            secondary
            onClick={() => {
              // Animated clear: dismiss each stored toast with a grace
              // period matching the toaster's exit duration (read from
              // the CSS variable the component sets inline) so the
              // stack collapses smoothly instead of snapping away.
              const el = document.querySelector(`[data-testid="demo-toaster"]`)
              const raw = el ? getComputedStyle(el).getPropertyValue('--toaster-exit-duration').trim() : ''
              const grace = Number.parseInt(raw, 10) || 150
              const stored = toasterService.getToasts(DEMO_TOASTER_ID)
              for (const t of stored) toasterService.dismiss(DEMO_TOASTER_ID, t.id, grace)
            }}
          >
            Clear all
          </Button>
          <Button
            data-testid="toaster-dismiss-last"
            secondary
            onClick={() => {
              const toasts = toasterService.getToasts(DEMO_TOASTER_ID)
              const last = toasts[toasts.length - 1]
              if (last) toasterService.dismiss(DEMO_TOASTER_ID, last.id, 150)
            }}
          >
            Dismiss last
          </Button>
        </div>
      </fieldset>
    </div>
  )
}

export default ToasterTab
