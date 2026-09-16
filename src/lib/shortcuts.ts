/**
 * Keyboard-first plumbing.
 *
 * Shortcuts are declared once, here, so the command palette can show the same
 * bindings the window listener honours -- there is no second list to drift.
 */

export interface Shortcut {
  /** Lowercase `event.key`, or a `Digit`/`F2`-style key name. */
  key: string
  mod?: boolean
  shift?: boolean
  alt?: boolean
}

export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false
  return /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || '')
}

/** Human label, e.g. `Cmd K` on macOS and `Ctrl K` elsewhere. */
export function formatShortcut(shortcut: Shortcut): string {
  const parts: string[] = []
  if (shortcut.mod) parts.push(isMac() ? 'Cmd' : 'Ctrl')
  if (shortcut.shift) parts.push('Shift')
  if (shortcut.alt) parts.push(isMac() ? 'Opt' : 'Alt')
  parts.push(shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key)
  return parts.join(' ')
}

export function matchesShortcut(event: KeyboardEvent, shortcut: Shortcut): boolean {
  const mod = isMac() ? event.metaKey : event.ctrlKey
  if (!!shortcut.mod !== mod) return false
  if (!!shortcut.shift !== event.shiftKey) return false
  if (!!shortcut.alt !== event.altKey) return false
  // On macOS the *other* modifier must not be held, or Ctrl+K would fire Cmd+K.
  if (shortcut.mod && (isMac() ? event.ctrlKey : event.metaKey)) return false
  return event.key.toLowerCase() === shortcut.key.toLowerCase()
}

/** True when the event came from somewhere that owns its own keystrokes. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}
