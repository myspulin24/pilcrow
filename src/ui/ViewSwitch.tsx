/**
 * The three-position view switch: raw Markdown, both, rendered preview.
 *
 * A single control rather than a "hide preview" toggle, because there are
 * genuinely three states and a checkbox can only express two. The thumb slides
 * between positions with a CSS transform, so dragging the mouse across it or
 * pressing the arrow keys both read as the same physical motion.
 */

import { useRef } from 'react'

import { stepMode, t, VIEW_MODES, type ViewMode } from '@/core'

const LABELS: Record<ViewMode, { short: string; title: string }> = {
  editor: { short: t.view.raw, title: t.view.rawHint },
  split: { short: t.view.both, title: t.view.bothHint },
  preview: { short: t.view.preview, title: t.view.previewHint },
}

export function ViewSwitch({
  mode,
  onChange,
}: {
  mode: ViewMode
  onChange: (mode: ViewMode) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  /**
   * Pointer capture is what makes dragging past the edge of the control keep
   * working, but it is optional: jsdom does not implement it, and releasing a
   * capture that was never taken throws. Neither should break the switch.
   */
  const capture = (element: Element, pointerId: number, take: boolean) => {
    try {
      if (take) element.setPointerCapture?.(pointerId)
      else element.releasePointerCapture?.(pointerId)
    } catch {
      /* dragging still works, it just stops at the control's edge */
    }
  }

  /** Which segment a pointer position falls in. */
  const modeAt = (clientX: number): ViewMode => {
    const track = trackRef.current
    if (!track) return mode
    const { left, width } = track.getBoundingClientRect()
    const ratio = (clientX - left) / Math.max(1, width)
    const index = Math.min(VIEW_MODES.length - 1, Math.max(0, Math.floor(ratio * VIEW_MODES.length)))
    return VIEW_MODES[index] ?? mode
  }

  const index = VIEW_MODES.indexOf(mode)

  return (
    <div
      className="view-switch"
      ref={trackRef}
      role="radiogroup"
      aria-label={t.view.label}
      onPointerDown={(event) => {
        dragging.current = true
        capture(event.currentTarget, event.pointerId, true)
        const next = modeAt(event.clientX)
        if (next !== mode) onChange(next)
      }}
      onPointerMove={(event) => {
        if (!dragging.current) return
        const next = modeAt(event.clientX)
        if (next !== mode) onChange(next)
      }}
      onPointerUp={(event) => {
        dragging.current = false
        capture(event.currentTarget, event.pointerId, false)
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          onChange(stepMode(mode, -1))
        } else if (event.key === 'ArrowRight') {
          event.preventDefault()
          onChange(stepMode(mode, 1))
        }
      }}
    >
      <span
        className="view-switch__thumb"
        aria-hidden="true"
        style={{ transform: `translateX(${index * 100}%)` }}
      />
      {VIEW_MODES.map((candidate) => (
        <button
          key={candidate}
          type="button"
          role="radio"
          aria-checked={candidate === mode}
          className={`view-switch__option ${candidate === mode ? 'is-active' : ''}`}
          title={LABELS[candidate].title}
          tabIndex={candidate === mode ? 0 : -1}
          onClick={() => onChange(candidate)}
        >
          {LABELS[candidate].short}
        </button>
      ))}
    </div>
  )
}
