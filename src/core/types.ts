/**
 * Core domain types.
 *
 * Everything in `src/core` is pure: no file system, no Tauri, no React. The
 * Markdown file on disk is the source of truth; these types describe what we
 * derive from it.
 */

/** Frontmatter as stored at the top of every note file. */
export interface NoteFrontmatter {
  id: string
  title: string
  created: string
  updated: string
  pinned: boolean
  /** Tags declared explicitly in frontmatter (inline `#tags` are merged in later). */
  tags: string[]
  /** Any key we do not understand is preserved verbatim on round-trip. */
  extra: Record<string, string>
}

/** A wiki link discovered in note body text. */
export interface WikiLink {
  /** Raw link target as written, e.g. `Reading List` or `daily/2026-09-15`. */
  target: string
  /** Display text (after `|`), or the target when no alias was given. */
  alias: string
  /** Heading fragment after `#`, if any. */
  heading: string | null
  /** Character offset of the `[[` in the body. */
  start: number
  /** Character offset just past the `]]`. */
  end: number
  /** The complete raw match, e.g. `[[Foo|bar]]`. */
  raw: string
}

/** Everything we can learn about a note by reading its file. */
export interface ParsedNote {
  frontmatter: NoteFrontmatter
  /** Body text with the frontmatter block removed. */
  body: string
  /** Frontmatter tags + inline `#tags`, normalised, de-duplicated, sorted. */
  tags: string[]
  links: WikiLink[]
  /** Short plain-text preview for list rows. */
  excerpt: string
  tasks: { total: number; done: number }
  wordCount: number
}

/** A note as the UI knows it: parsed content plus its location and disk state. */
export interface Note extends ParsedNote {
  /** Vault-relative POSIX path, e.g. `daily/2026-09-15.md`. */
  path: string
  /** SHA-256 of the exact bytes last read from or written to disk. */
  hash: string
  /** Disk mtime in milliseconds since the epoch. */
  mtime: number
  size: number
}

/** Lightweight row used by the note list and search results. */
export interface NoteSummary {
  id: string
  path: string
  title: string
  excerpt: string
  tags: string[]
  pinned: boolean
  created: string
  updated: string
  /** Search snippet with `<mark>` highlights, when the row came from a query. */
  snippet?: string
}

/** Parsed form of the search box contents. */
export interface SearchQuery {
  /** Free-text terms, already stripped of operators. */
  text: string
  tags: string[]
  excludeTags: string[]
  pinnedOnly: boolean
  hasTasks: boolean
  /** True when nothing at all was typed. */
  isEmpty: boolean
}

/** Result of comparing an in-editor buffer against what is now on disk. */
export interface ConflictState {
  path: string
  /** What the editor believes it is editing. */
  local: string
  /** What the file now contains. */
  disk: string
  /** Hash the editor loaded from. */
  baseHash: string
  diskHash: string
  detectedAt: number
}

export type ConflictResolution = 'keep-local' | 'use-disk' | 'keep-both'

/** Union of every recoverable failure the vault layer can report. */
export interface VaultError {
  kind:
    | 'not-found'
    | 'conflict'
    | 'invalid-name'
    | 'permission'
    | 'io'
    | 'unavailable'
    | 'duplicate'
  message: string
  /** Present when `kind === 'conflict'`. */
  conflict?: ConflictState
}

export function isVaultError(value: unknown): value is VaultError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    'message' in value &&
    typeof (value as VaultError).message === 'string'
  )
}
