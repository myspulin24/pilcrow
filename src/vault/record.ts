/**
 * Deriving index records from note files.
 *
 * The SQLite index is a cache: every column here can be recomputed from the
 * Markdown file, which is what makes `Rebuild index` a safe operation and what
 * lets the index be deleted at any time.
 */

import { hashText, linkKey, parseNote, titleFromPath, type ParsedNote } from '@/core'
import type { IndexRecord, NoteFile } from './api'

/** Build the index row for a note whose text we already have. */
export function toIndexRecord(path: string, content: string, parsed?: ParsedNote): IndexRecord {
  const note = parsed ?? parseNote(content, { path })
  return {
    path,
    id: note.frontmatter.id,
    title: note.frontmatter.title || titleFromPath(path),
    body: note.body,
    excerpt: note.excerpt,
    tags: note.tags,
    // Store normalised targets so the index can answer "what links here?"
    // without re-parsing.
    links: [...new Set(note.links.map((link) => linkKey(link.target)))].filter(Boolean),
    pinned: note.frontmatter.pinned,
    created: note.frontmatter.created,
    updated: note.frontmatter.updated,
    hasTasks: note.tasks.total > 0,
    hash: hashText(content),
    mtime: Date.now(),
    size: new TextEncoder().encode(content).length,
  }
}

/** Build index rows for a whole vault read. */
export function toIndexRecords(files: NoteFile[]): IndexRecord[] {
  return files.map((file) => {
    const record = toIndexRecord(file.path, file.content)
    record.hash = file.hash
    record.mtime = file.mtime
    record.size = file.size
    return record
  })
}
