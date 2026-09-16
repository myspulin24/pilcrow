/**
 * How the document pane is split.
 *
 * Three states, not a boolean: the raw Markdown, both side by side, or just
 * the rendered preview. Keeping the transitions here (rather than inside the
 * switch component) means the keyboard shortcut, the drag and the click all go
 * through the same two functions.
 */

export type ViewMode = 'editor' | 'split' | 'preview'

export const VIEW_MODES: readonly ViewMode[] = ['editor', 'split', 'preview']

/** Move one step through the modes, clamped at the ends. */
export function stepMode(current: ViewMode, delta: number): ViewMode {
  const index = VIEW_MODES.indexOf(current)
  if (index === -1) return 'split'
  const next = Math.min(VIEW_MODES.length - 1, Math.max(0, index + delta))
  return VIEW_MODES[next] ?? current
}

/** Move one step, wrapping around. Used by the keyboard shortcut. */
export function cycleMode(current: ViewMode): ViewMode {
  const index = VIEW_MODES.indexOf(current)
  if (index === -1) return 'split'
  return VIEW_MODES[(index + 1) % VIEW_MODES.length] ?? 'split'
}

export function showsEditor(mode: ViewMode): boolean {
  return mode !== 'preview'
}

export function showsPreview(mode: ViewMode): boolean {
  return mode !== 'editor'
}
