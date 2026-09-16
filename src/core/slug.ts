/**
 * Safe file names and vault-relative paths.
 *
 * Every string that reaches the file system goes through here first. The rules
 * are the intersection of what macOS, Windows and iCloud Drive all accept, so
 * a vault written on one machine always opens on the others:
 *
 *   - no `< > : " / \ | ? *`, no control characters
 *   - no leading/trailing dots or spaces (Windows silently strips them)
 *   - not a reserved DOS device name (CON, PRN, AUX, NUL, COM1..9, LPT1..9)
 *   - never empty, never longer than 120 characters
 *   - no `..` segments, never absolute
 */

import { t } from './messages'

const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f\u007f]/g
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i
const MAX_NAME_LENGTH = 120

export const MARKDOWN_EXTENSION = '.md'

/** Turn arbitrary user text into a single safe file-name segment (no extension). */
export function safeFileName(input: string, fallback = 'bez-nazvu'): string {
  let name = (input ?? '')
    .normalize('NFC')
    .replace(/\r?\n/g, ' ')
    .replace(ILLEGAL, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '')
    .replace(/-{3,}/g, '--')

  if (RESERVED.test(name)) name = `${name}-note`
  if (name.length > MAX_NAME_LENGTH) {
    name = name.slice(0, MAX_NAME_LENGTH).replace(/[.\s]+$/, '')
  }
  return name || fallback
}

export interface NameValidation {
  ok: boolean
  /** The value that would actually be used. */
  value: string
  /** Human-readable reason, present when `ok` is false or the name was changed. */
  message?: string
}

/** Validate a name the user typed, explaining what will happen to it. */
export function validateNoteName(input: string): NameValidation {
  const trimmed = (input ?? '').trim()
  if (!trimmed) return { ok: false, value: '', message: t.names.empty }
  if (trimmed.length > MAX_NAME_LENGTH) {
    return {
      ok: false,
      value: safeFileName(trimmed),
      message: t.names.tooLong(MAX_NAME_LENGTH),
    }
  }
  // Pass an empty fallback so a name that sanitises to nothing is reported
  // rather than silently becoming "bez-nazvu".
  const safe = safeFileName(trimmed, '')
  if (!safe) return { ok: false, value: '', message: t.names.noUsableChars }
  if (safe !== trimmed) {
    return { ok: true, value: safe, message: t.names.sanitised(safe) }
  }
  return { ok: true, value: safe }
}

/**
 * Normalise a vault-relative path: POSIX separators, no `.`/`..`, no leading
 * slash, every segment sanitised, `.md` extension enforced for notes.
 */
export function safeNotePath(input: string, fallback = 'bez-nazvu'): string {
  const segments = (input ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '' && segment !== '.' && segment !== '..')

  if (segments.length === 0) return `${fallback}${MARKDOWN_EXTENSION}`

  const last = segments.pop()!
  const base = last.toLowerCase().endsWith(MARKDOWN_EXTENSION)
    ? last.slice(0, -MARKDOWN_EXTENSION.length)
    : last

  const folders = segments.map((segment) => safeFileName(segment, 'folder'))
  const file = safeFileName(base, fallback)
  return [...folders, `${file}${MARKDOWN_EXTENSION}`].join('/')
}

/** Normalise a folder path (no file component). `''` means the vault root. */
export function safeFolderPath(input: string): string {
  return (input ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '' && segment !== '.' && segment !== '..')
    .map((segment) => safeFileName(segment, 'folder'))
    .join('/')
}

/**
 * Reject anything that tries to escape the vault. The Rust side enforces this
 * again by canonicalising against the vault root; this is the first gate.
 */
export function isPathInsideVault(relativePath: string): boolean {
  if (!relativePath) return false
  const normalised = relativePath.replace(/\\/g, '/')
  if (normalised.startsWith('/')) return false
  if (/^[A-Za-z]:/.test(normalised)) return false
  if (normalised.startsWith('//')) return false
  return !normalised.split('/').some((segment) => segment === '..')
}

/** Title shown for a note that has no explicit frontmatter title. */
export function titleFromPath(path: string): string {
  const base = path.split('/').pop() ?? path
  return base.toLowerCase().endsWith(MARKDOWN_EXTENSION)
    ? base.slice(0, -MARKDOWN_EXTENSION.length)
    : base
}

/** Join a folder and a file name into a vault-relative note path. */
export function joinNotePath(folder: string, name: string): string {
  const cleanFolder = safeFolderPath(folder)
  const file = `${safeFileName(name)}${MARKDOWN_EXTENSION}`
  return cleanFolder ? `${cleanFolder}/${file}` : file
}

/**
 * Pick a path that does not collide with an existing one by appending ` 2`,
 * ` 3`, ... before the extension.
 */
export function uniquePath(desired: string, taken: Iterable<string>): string {
  const existing = new Set([...taken].map((path) => path.toLowerCase()))
  if (!existing.has(desired.toLowerCase())) return desired

  const dot = desired.lastIndexOf('.')
  const stem = dot === -1 ? desired : desired.slice(0, dot)
  const extension = dot === -1 ? '' : desired.slice(dot)
  for (let index = 2; index < 1000; index++) {
    const candidate = `${stem} ${index}${extension}`
    if (!existing.has(candidate.toLowerCase())) return candidate
  }
  return `${stem} ${Date.now()}${extension}`
}

/** Safe name for an imported attachment, preserving a known image extension. */
export function safeAttachmentName(originalName: string, now = new Date()): string {
  // A drag-and-drop can hand us a whole path; only the final segment is a name.
  const base = (originalName ?? '').split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  const rawExtension = dot === -1 ? '' : base.slice(dot + 1).toLowerCase()
  const extension = /^[a-z0-9]{1,8}$/.test(rawExtension) ? rawExtension : 'bin'
  const stem = safeFileName(dot === -1 ? base : base.slice(0, dot), 'attachment')
  const stamp = now.toISOString().slice(0, 19).replace(/[:T-]/g, '').slice(0, 14)
  return `${stamp}-${stem}.${extension}`
}
