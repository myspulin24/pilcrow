/**
 * Search query parsing plus a pure in-memory matcher.
 *
 * The SQLite FTS5 index does the real work in the desktop app, but the same
 * parsed query drives the in-memory adapter and the FTS5-unavailable fallback,
 * so search behaves identically in all three.
 *
 * Syntax (Czech and English spellings both work, because the app is in Czech
 * but the operators are also what anyone used to this kind of search expects):
 *
 *   plain words                    all must match (title, body or tag)
 *   "exact phrase"                 matched verbatim
 *   stitek:prace  / tag:work       note must carry that tag, or a child of it
 *   -stitek:archiv / -tag:archive  note must not carry that tag
 *   je:pripnute   / is:pinned      pinned notes only
 *   ma:ukoly      / has:tasks      notes with at least one task item
 */

import { expandTagAncestors, normalizeTag } from './tags'
import type { SearchQuery } from './types'

export const EMPTY_QUERY: SearchQuery = {
  text: '',
  tags: [],
  excludeTags: [],
  pinnedOnly: false,
  hasTasks: false,
  isEmpty: true,
}

/** Split a query string into tokens, honouring double quotes. */
export function tokenize(input: string): string[] {
  const tokens: string[] = []
  const pattern = /"([^"]*)"|(\S+)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(input)) !== null) {
    const value = match[1] !== undefined ? match[1] : (match[2] ?? '')
    if (value.trim()) tokens.push(match[1] !== undefined ? value : value.trim())
  }
  return tokens
}

export function parseSearchQuery(input: string): SearchQuery {
  const raw = (input ?? '').trim()
  if (!raw) return { ...EMPTY_QUERY }

  const tags: string[] = []
  const excludeTags: string[] = []
  const words: string[] = []
  let pinnedOnly = false
  let hasTasks = false

  for (const token of tokenize(raw)) {
    const negated = token.startsWith('-')
    const body = negated ? token.slice(1) : token
    const colon = body.indexOf(':')
    const field = colon === -1 ? '' : body.slice(0, colon).toLowerCase()
    const value = colon === -1 ? '' : body.slice(colon + 1)

    // Both spellings of every operator, so neither language is second class.
    if (field === 'tag' || field === 'stitek' || field === 'štítek' || field === '#') {
      const tag = normalizeTag(value)
      if (tag) (negated ? excludeTags : tags).push(tag)
      continue
    }
    const lowered = value.toLowerCase()
    if ((field === 'is' || field === 'je') && (lowered === 'pinned' || lowered === 'pripnute' || lowered === 'připnuté')) {
      pinnedOnly = !negated
      continue
    }
    if (
      (field === 'has' || field === 'ma' || field === 'má') &&
      ['tasks', 'task', 'ukoly', 'úkoly', 'ukol', 'úkol'].includes(lowered)
    ) {
      hasTasks = !negated
      continue
    }
    if (token.startsWith('#') && token.length > 1) {
      const tag = normalizeTag(token)
      if (tag) tags.push(tag)
      continue
    }
    words.push(token)
  }

  const text = words.join(' ').trim()
  return {
    text,
    tags,
    excludeTags,
    pinnedOnly,
    hasTasks,
    isEmpty: text === '' && tags.length === 0 && excludeTags.length === 0 && !pinnedOnly && !hasTasks,
  }
}

/**
 * Translate a parsed query into an FTS5 MATCH expression.
 * Returns `null` when there is nothing full-text to match on.
 */
export function toFtsExpression(query: SearchQuery): string | null {
  const terms = tokenize(query.text)
    .map((term) => term.replace(/["*]/g, '').trim())
    .filter(Boolean)
  if (terms.length === 0) return null
  return terms.map((term) => (term.includes(' ') ? `"${term}"` : `"${term}"*`)).join(' AND ')
}

export interface SearchableNote {
  path: string
  title: string
  body: string
  tags: string[]
  pinned: boolean
  hasTasks: boolean
  updated: string
}

export interface ScoredNote<T> {
  note: T
  score: number
  snippet: string
}

function tagMatches(noteTags: string[], wanted: string): boolean {
  return noteTags.some((tag) => expandTagAncestors(tag).includes(wanted))
}

/**
 * Score one note against a query. Returns `null` when it does not match.
 *
 * Weighting mirrors what people expect: a title hit beats a tag hit beats a
 * body hit, and an exact prefix beats a match in the middle of a word.
 */
export function scoreNote<T extends SearchableNote>(note: T, query: SearchQuery): ScoredNote<T> | null {
  if (query.pinnedOnly && !note.pinned) return null
  if (query.hasTasks && !note.hasTasks) return null
  for (const tag of query.tags) if (!tagMatches(note.tags, tag)) return null
  for (const tag of query.excludeTags) if (tagMatches(note.tags, tag)) return null

  const terms = tokenize(query.text).map((term) => term.toLowerCase()).filter(Boolean)
  if (terms.length === 0) {
    return { note, score: note.pinned ? 1.5 : 1, snippet: '' }
  }

  const title = note.title.toLowerCase()
  const body = note.body.toLowerCase()
  const tags = note.tags.join(' ').toLowerCase()

  let score = 0
  let snippetIndex = -1

  for (const term of terms) {
    const inTitle = title.indexOf(term)
    const inTags = tags.indexOf(term)
    const inBody = body.indexOf(term)
    if (inTitle === -1 && inTags === -1 && inBody === -1) return null

    if (inTitle !== -1) score += title === term ? 40 : inTitle === 0 ? 24 : 12
    if (inTags !== -1) score += 8
    if (inBody !== -1) {
      score += 3
      if (snippetIndex === -1) snippetIndex = inBody
    }
  }

  if (note.pinned) score += 5

  return { note, score, snippet: snippetIndex === -1 ? '' : buildSnippet(note.body, snippetIndex, terms) }
}

/** Build a `<mark>`-highlighted snippet around a hit. Escapes its input. */
export function buildSnippet(body: string, index: number, terms: string[], radius = 70): string {
  const start = Math.max(0, index - radius)
  const end = Math.min(body.length, index + radius)
  const slice = body.slice(start, end).replace(/\s+/g, ' ').trim()
  const escaped = slice
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  let highlighted = escaped
  for (const term of terms) {
    if (!term) continue
    const pattern = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
    highlighted = highlighted.replace(pattern, '<mark>$1</mark>')
  }
  return `${start > 0 ? '...' : ''}${highlighted}${end < body.length ? '...' : ''}`
}

/** Run a query across notes, best match first. */
export function searchNotes<T extends SearchableNote>(notes: T[], query: SearchQuery): Array<ScoredNote<T>> {
  const results: Array<ScoredNote<T>> = []
  for (const note of notes) {
    const scored = scoreNote(note, query)
    if (scored) results.push(scored)
  }
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return b.note.updated.localeCompare(a.note.updated)
  })
  return results
}

/**
 * Subsequence fuzzy match used by the command palette.
 * Returns a score (higher is better) or `null` when the pattern does not fit.
 */
export function fuzzyScore(pattern: string, candidate: string): number | null {
  const needle = pattern.toLowerCase().replace(/\s+/g, '')
  if (!needle) return 0
  const haystack = candidate.toLowerCase()

  let score = 0
  let cursor = 0
  let previousIndex = -1

  for (const char of needle) {
    const index = haystack.indexOf(char, cursor)
    if (index === -1) return null
    score += 1
    if (index === previousIndex + 1) score += 4
    if (index === 0 || /[\s/_-]/.test(haystack[index - 1] ?? '')) score += 3
    previousIndex = index
    cursor = index + 1
  }
  // Prefer shorter candidates when the match quality is equal.
  return score - haystack.length * 0.01
}
