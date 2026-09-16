/**
 * Wiki link parsing, resolution and rewriting.
 *
 * Supported forms:
 *   [[Target]]
 *   [[Target|Display text]]
 *   [[Target#Heading]]
 *   [[Target#Heading|Display text]]
 *   [[folder/Target]]
 */

import { maskCode } from './mask'
import type { WikiLink } from './types'

const WIKI_LINK = /\[\[([^\]\n]*?)\]\]/g

/** Parse the inside of a `[[...]]` into target / heading / alias. */
export function parseLinkTarget(inner: string): { target: string; heading: string | null; alias: string } {
  const pipe = inner.indexOf('|')
  const left = (pipe === -1 ? inner : inner.slice(0, pipe)).trim()
  const aliasRaw = pipe === -1 ? '' : inner.slice(pipe + 1).trim()

  const hash = left.indexOf('#')
  const target = (hash === -1 ? left : left.slice(0, hash)).trim()
  const heading = hash === -1 ? null : left.slice(hash + 1).trim() || null

  return { target, heading, alias: aliasRaw || left || target }
}

/** Find every wiki link in body text, skipping code spans and blocks. */
export function findWikiLinks(body: string): WikiLink[] {
  const mask = maskCode(body)
  const links: WikiLink[] = []
  let match: RegExpExecArray | null
  WIKI_LINK.lastIndex = 0
  while ((match = WIKI_LINK.exec(mask)) !== null) {
    const raw = body.slice(match.index, match.index + match[0].length)
    const inner = raw.slice(2, -2)
    const { target, heading, alias } = parseLinkTarget(inner)
    if (!target) continue
    links.push({
      target,
      alias,
      heading,
      start: match.index,
      end: match.index + match[0].length,
      raw,
    })
  }
  return links
}

/**
 * Normalise a link target for matching: case-insensitive, extension-less,
 * separator-agnostic. `Notes/My Note.md` and `notes/my note` both become
 * `notes/my note`.
 */
export function linkKey(target: string): string {
  return target
    .trim()
    // macOS stores file names decomposed (NFD), Windows and Linux composed
    // (NFC). A vault synced through iCloud therefore hands us "č" spelled two
    // different ways for the same note; without this, `[[Čtení]]` written on a
    // Mac would not resolve to `Čtení.md` created on Windows.
    .normalize('NFC')
    .replace(/\\/g, '/')
    .replace(/\.md$/i, '')
    .replace(/^\.\//, '')
    .replace(/\/+/g, '/')
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

export interface LinkTargetIndex {
  /** Map of normalised key -> note path. */
  byKey: Map<string, string>
}

/**
 * Build the lookup used to resolve `[[targets]]`. Each note is registered
 * under its full path, its path without extension, and its title, so links
 * work whether they were written against the file name or the display title.
 */
export function buildLinkIndex(notes: Array<{ path: string; title: string }>): LinkTargetIndex {
  const byKey = new Map<string, string>()
  const register = (key: string, path: string) => {
    const normalised = linkKey(key)
    if (!normalised) return
    // First registration wins, so a title never shadows an exact path match.
    if (!byKey.has(normalised)) byKey.set(normalised, path)
  }
  // Two passes: paths are more specific than titles and must be registered first.
  for (const note of notes) {
    register(note.path, note.path)
    const basename = note.path.split('/').pop() ?? note.path
    register(basename, note.path)
  }
  for (const note of notes) register(note.title, note.path)
  return { byKey }
}

/** Resolve a single link target to a note path, or `null` when it is unresolved. */
export function resolveLink(index: LinkTargetIndex, target: string): string | null {
  return index.byKey.get(linkKey(target)) ?? null
}

export interface Backlink {
  /** Path of the note that contains the link. */
  from: string
  /** Surrounding text, trimmed to a readable snippet. */
  context: string
  alias: string
}

/**
 * Compute backlinks for `targetPath` by scanning every note body.
 *
 * This is deliberately a pure function over already-loaded note bodies: the
 * SQLite index stores the same edges for speed, but the app can always fall
 * back to recomputing them from the files themselves.
 */
export function computeBacklinks(
  targetPath: string,
  notes: Array<{ path: string; title: string; body: string }>,
): Backlink[] {
  const index = buildLinkIndex(notes)
  const out: Backlink[] = []
  for (const note of notes) {
    if (note.path === targetPath) continue
    for (const link of findWikiLinks(note.body)) {
      if (resolveLink(index, link.target) !== targetPath) continue
      out.push({ from: note.path, context: snippetAround(note.body, link.start, link.end), alias: link.alias })
    }
  }
  return out
}

/** A single-line excerpt centred on a character range. */
export function snippetAround(text: string, start: number, end: number, radius = 60): string {
  const lineStart = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1
  const lineEndRaw = text.indexOf('\n', end)
  const lineEnd = lineEndRaw === -1 ? text.length : lineEndRaw
  const line = text.slice(lineStart, lineEnd).trim()
  if (line.length <= radius * 2) return line

  const relative = start - lineStart
  const from = Math.max(0, relative - radius)
  const to = Math.min(line.length, relative + radius)
  return `${from > 0 ? '...' : ''}${line.slice(from, to).trim()}${to < line.length ? '...' : ''}`
}

/**
 * Rewrite every `[[link]]` that points at `fromTarget` so it points at
 * `toTarget`, preserving aliases and heading fragments.
 *
 * This is what keeps backlinks intact when a note is renamed or moved. It is
 * intentionally conservative: a link is only rewritten when it resolves to the
 * note being renamed.
 */
export function rewriteLinks(
  body: string,
  matches: (target: string) => boolean,
  toTarget: string,
): { body: string; changed: number } {
  const links = findWikiLinks(body)
  if (links.length === 0) return { body, changed: 0 }

  let result = ''
  let cursor = 0
  let changed = 0

  for (const link of links) {
    if (!matches(link.target)) continue
    result += body.slice(cursor, link.start)
    const heading = link.heading ? `#${link.heading}` : ''
    // Keep an explicit alias; drop an implicit one that just echoed the target.
    const hadExplicitAlias = link.raw.includes('|')
    const alias = hadExplicitAlias ? `|${link.alias}` : ''
    result += `[[${toTarget}${heading}${alias}]]`
    cursor = link.end
    changed += 1
  }
  result += body.slice(cursor)
  return changed === 0 ? { body, changed: 0 } : { body: result, changed }
}

/** Insert a wiki link at a cursor position, returning the new text and caret. */
export function insertLink(
  body: string,
  selectionStart: number,
  selectionEnd: number,
  target: string,
): { body: string; caret: number } {
  const selected = body.slice(selectionStart, selectionEnd).trim()
  const snippet = selected && selected !== target ? `[[${target}|${selected}]]` : `[[${target}]]`
  return {
    body: body.slice(0, selectionStart) + snippet + body.slice(selectionEnd),
    caret: selectionStart + snippet.length,
  }
}
