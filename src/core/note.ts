/**
 * The central transformation: Markdown file text <-> `ParsedNote`.
 *
 * `parseNote(serializeNoteFile(note)) === note` for everything Pilcrow cares
 * about, and parsing a note written by any other Markdown editor never throws:
 * missing frontmatter is filled in from the file name and the body.
 */

import { readFrontmatter, serializeNote, splitFrontmatter } from './frontmatter'
import { collectTags } from './tags'
import { titleFromPath } from './slug'
import { findWikiLinks } from './wikilinks'
import type { NoteFrontmatter, ParsedNote } from './types'

/**
 * Sortable, collision-resistant id: 8 chars of base36 time + 8 of base36
 * randomness. Short enough to read in a frontmatter block, unique enough for a
 * personal vault synced across a handful of devices.
 */
export function generateId(now: number = Date.now(), random: () => number = Math.random): string {
  const time = Math.floor(now).toString(36).padStart(8, '0').slice(-8)
  let suffix = ''
  for (let i = 0; i < 8; i++) {
    suffix += Math.floor(random() * 36).toString(36)
  }
  return `${time}${suffix}`
}

/** First `# Heading` in the body, if the body starts with one. */
export function headingTitle(body: string): string | null {
  const match = /^[ \t]{0,3}#[ \t]+(.+?)[ \t]*#*[ \t]*$/m.exec(body.split('\n').slice(0, 5).join('\n'))
  return match ? (match[1] ?? '').trim() || null : null
}

/** Plain-text preview: strip Markdown syntax, collapse whitespace, truncate. */
export function buildExcerpt(body: string, limit = 180): string {
  const text = body
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')
    .replace(/~~~[\s\S]*?(?:~~~|$)/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    // Vzorce ještě před odstraněním zdůraznění, jinak by se z `c_{min}`
    // stalo `c{min}`. Samostatný vzorec se v jednořádkovém úryvku stejně
    // přečíst nedá, tak z něj zbude značka; ten v řádku bývá krátký.
    .replace(/\$\$[\s\S]*?\$\$/g, ' ⟨vzorec⟩ ')
    .replace(/(^|[^\d\\$])\$(?!\s)((?:[^$\n\\]|\\.)+?)(?<!\s)\$(?!\d)/g, '$1$2')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_full, target: string, alias: string) => alias || target)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/^\s{0,3}(?:[-*_]\s*){3,}$/gm, ' ')
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (text.length <= limit) return text
  const cut = text.slice(0, limit)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}...`
}

/** Count `- [ ]` / `- [x]` task list items. */
export function countTasks(body: string): { total: number; done: number } {
  let total = 0
  let done = 0
  const pattern = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[([ xX])\][ \t]+/gm
  let match: RegExpExecArray | null
  while ((match = pattern.exec(body)) !== null) {
    total += 1
    if ((match[1] ?? '').toLowerCase() === 'x') done += 1
  }
  return { total, done }
}

export function countWords(body: string): number {
  const text = body.replace(/```[\s\S]*?(?:```|$)/g, ' ').trim()
  if (!text) return 0
  return text.split(/\s+/).filter(Boolean).length
}

export interface ParseOptions {
  /** Vault-relative path; used to derive a title when frontmatter has none. */
  path?: string
  /** Clock injection, so tests are deterministic. */
  now?: () => string
  random?: () => number
}

/**
 * Parse raw file text into a `ParsedNote`. Never throws: any file that is
 * valid UTF-8 produces a usable note.
 */
export function parseNote(source: string, options: ParseOptions = {}): ParsedNote {
  const path = options.path ?? ''
  const nowIso = options.now ?? (() => new Date().toISOString())
  const raw = splitFrontmatter(source ?? '')
  const body = raw.body

  const fallbackTitle = headingTitle(body) ?? (path ? titleFromPath(path) : 'Untitled')
  const stamp = nowIso()

  const frontmatter: NoteFrontmatter = readFrontmatter(raw, {
    title: fallbackTitle,
    created: stamp,
    updated: stamp,
  })
  if (!frontmatter.id) {
    frontmatter.id = generateId(Date.parse(stamp) || Date.now(), options.random)
  }
  if (!frontmatter.title) frontmatter.title = fallbackTitle
  if (!frontmatter.created) frontmatter.created = stamp
  if (!frontmatter.updated) frontmatter.updated = frontmatter.created

  return {
    frontmatter,
    body,
    tags: collectTags(frontmatter.tags, body),
    links: findWikiLinks(body),
    excerpt: buildExcerpt(body),
    tasks: countTasks(body),
    wordCount: countWords(body),
  }
}

/** Serialise a parsed note back to file text. */
export function serializeNoteFile(note: Pick<ParsedNote, 'frontmatter' | 'body'>): string {
  return serializeNote(note.frontmatter, note.body)
}

export interface NewNoteOptions {
  title: string
  body?: string
  tags?: string[]
  pinned?: boolean
  now?: Date
  random?: () => number
}

/** Build the file text for a brand-new note. */
export function createNoteFile(options: NewNoteOptions): string {
  const now = options.now ?? new Date()
  const iso = now.toISOString()
  const frontmatter: NoteFrontmatter = {
    id: generateId(now.getTime(), options.random),
    title: options.title.trim() || 'Untitled',
    created: iso,
    updated: iso,
    pinned: options.pinned ?? false,
    tags: (options.tags ?? []).slice().sort(),
    extra: {},
  }
  const body = options.body ?? `# ${frontmatter.title}\n\n`
  return serializeNote(frontmatter, body)
}

/**
 * Apply a body edit, refreshing derived frontmatter (`updated`, `tags`) while
 * leaving everything else -- including unknown keys -- untouched.
 */
export function applyBodyEdit(
  note: ParsedNote,
  body: string,
  now: Date = new Date(),
): ParsedNote {
  const inlineAndDeclared = collectTags(note.frontmatter.tags, body)
  const frontmatter: NoteFrontmatter = {
    ...note.frontmatter,
    updated: now.toISOString(),
    // Frontmatter keeps only the tags that are not already inline, so a tag is
    // never written twice; everything else is recomputed on read.
    tags: note.frontmatter.tags
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice()
      .sort(),
  }
  return {
    frontmatter,
    body,
    tags: inlineAndDeclared,
    links: findWikiLinks(body),
    excerpt: buildExcerpt(body),
    tasks: countTasks(body),
    wordCount: countWords(body),
  }
}

/** Set the title in both frontmatter and a leading `# Heading`, if present. */
export function retitleNote(note: ParsedNote, title: string, now: Date = new Date()): ParsedNote {
  const clean = title.trim() || 'Untitled'
  let body = note.body
  const existing = headingTitle(body)
  if (existing) {
    body = body.replace(/^([ \t]{0,3}#[ \t]+)(.+?)([ \t]*#*[ \t]*)$/m, `$1${clean.replace(/\$/g, '$$$$')}`)
  }
  const updated = applyBodyEdit(note, body, now)
  updated.frontmatter.title = clean
  return updated
}

/** Toggle the `pinned` flag. */
export function setPinned(note: ParsedNote, pinned: boolean, now: Date = new Date()): ParsedNote {
  return {
    ...note,
    frontmatter: { ...note.frontmatter, pinned, updated: now.toISOString() },
  }
}

/**
 * Toggle the Nth task checkbox in the body.
 *
 * Returns the body unchanged when the index does not exist, so a stale render
 * can never corrupt a file.
 */
export function toggleTask(body: string, index: number): string {
  const pattern = /^([ \t]*(?:[-*+]|\d+[.)])[ \t]+\[)([ xX])(\][ \t]+)/gm
  let seen = -1
  return body.replace(pattern, (full, prefix: string, mark: string, suffix: string) => {
    seen += 1
    if (seen !== index) return full
    return `${prefix}${mark.toLowerCase() === 'x' ? ' ' : 'x'}${suffix}`
  })
}
