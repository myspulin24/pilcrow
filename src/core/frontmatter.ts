/**
 * A deliberately small YAML-ish frontmatter reader/writer.
 *
 * We only support the handful of shapes Reader_MJ writes -- scalars, quoted
 * scalars, inline `[a, b]` lists and block `- item` lists. That is enough to
 * round-trip our own files and to read the frontmatter other Markdown editors
 * produce, without pulling a YAML parser into the bundle. Unknown keys are
 * preserved verbatim so that another tool's metadata survives an edit.
 */

import type { NoteFrontmatter } from './types'

const DELIMITER = '---'

export interface RawFrontmatter {
  /** Ordered key/value pairs. List values arrive already split. */
  fields: Map<string, string | string[]>
  /** Body text with the frontmatter block removed. */
  body: string
  /** True when the document actually started with a `---` block. */
  present: boolean
}

/** Split a document into its frontmatter fields and its body. */
export function splitFrontmatter(source: string): RawFrontmatter {
  const text = source.replace(/^﻿/, '')
  const normalised = text.replace(/\r\n/g, '\n')
  const fields = new Map<string, string | string[]>()

  if (!normalised.startsWith(DELIMITER)) {
    return { fields, body: normalised, present: false }
  }

  const lines = normalised.split('\n')
  if (lines[0]?.trim() !== DELIMITER) {
    return { fields, body: normalised, present: false }
  }

  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === DELIMITER) {
      end = i
      break
    }
  }
  // An unterminated block is not frontmatter -- treat the whole file as body.
  if (end === -1) {
    return { fields, body: normalised, present: false }
  }

  let currentListKey: string | null = null
  for (let i = 1; i < end; i++) {
    const line = lines[i] ?? ''
    if (!line.trim() || line.trim().startsWith('#')) continue

    const blockItem = /^\s*-\s+(.*)$/.exec(line)
    if (blockItem && currentListKey) {
      const list = fields.get(currentListKey)
      const item = unquote(blockItem[1] ?? '')
      if (Array.isArray(list)) list.push(item)
      else fields.set(currentListKey, [item])
      continue
    }

    const match = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line)
    if (!match) continue
    const key = match[1] ?? ''
    const rawValue = (match[2] ?? '').trim()

    if (rawValue === '') {
      // Either an empty scalar or the header of a block list; assume list and
      // downgrade to an empty string at read time if no items follow.
      currentListKey = key
      fields.set(key, [])
      continue
    }

    currentListKey = null
    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      fields.set(key, splitInlineList(rawValue.slice(1, -1)))
    } else {
      fields.set(key, unquote(rawValue))
    }
  }

  const body = lines.slice(end + 1).join('\n').replace(/^\n/, '')
  return { fields, body, present: true }
}

function splitInlineList(inner: string): string[] {
  return inner
    .split(',')
    .map((part) => unquote(part.trim()))
    .filter((part) => part.length > 0)
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2) {
    const first = trimmed[0]
    const last = trimmed[trimmed.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed
        .slice(1, -1)
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\')
    }
  }
  return trimmed
}

/** Quote a scalar only when YAML would otherwise mis-read it. */
export function quoteIfNeeded(value: string): string {
  if (value === '') return '""'
  if (/^[A-Za-z0-9][A-Za-z0-9 _./@+-]*$/.test(value) && !/^(true|false|null|yes|no|on|off)$/i.test(value)) {
    return value
  }
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

const KNOWN_KEYS = new Set(['id', 'title', 'created', 'updated', 'pinned', 'tags'])

/** Turn raw fields into a typed frontmatter record, filling in safe defaults. */
export function readFrontmatter(raw: RawFrontmatter, fallback: Partial<NoteFrontmatter> = {}): NoteFrontmatter {
  const scalar = (key: string): string => {
    const value = raw.fields.get(key)
    if (Array.isArray(value)) return value.join(', ')
    return value ?? ''
  }

  const tagsValue = raw.fields.get('tags')
  const tags = Array.isArray(tagsValue)
    ? tagsValue
    : typeof tagsValue === 'string' && tagsValue.trim() !== ''
      ? tagsValue.split(/[,\s]+/).filter(Boolean)
      : []

  const extra: Record<string, string> = {}
  for (const [key, value] of raw.fields) {
    if (KNOWN_KEYS.has(key)) continue
    extra[key] = Array.isArray(value) ? `[${value.join(', ')}]` : value
  }

  const pinnedRaw = scalar('pinned').toLowerCase()

  return {
    id: scalar('id') || fallback.id || '',
    title: scalar('title') || fallback.title || '',
    created: scalar('created') || fallback.created || '',
    updated: scalar('updated') || fallback.updated || '',
    pinned: pinnedRaw === 'true' || pinnedRaw === 'yes' || (pinnedRaw === '' ? !!fallback.pinned : false),
    tags,
    extra,
  }
}

/** Serialise frontmatter + body back into a complete file. */
export function serializeNote(frontmatter: NoteFrontmatter, body: string): string {
  const lines: string[] = [DELIMITER]
  lines.push(`id: ${quoteIfNeeded(frontmatter.id)}`)
  lines.push(`title: ${quoteIfNeeded(frontmatter.title)}`)
  lines.push(`created: ${quoteIfNeeded(frontmatter.created)}`)
  lines.push(`updated: ${quoteIfNeeded(frontmatter.updated)}`)
  lines.push(`pinned: ${frontmatter.pinned ? 'true' : 'false'}`)
  lines.push(`tags: [${frontmatter.tags.map(quoteIfNeeded).join(', ')}]`)
  for (const [key, value] of Object.entries(frontmatter.extra)) {
    if (KNOWN_KEYS.has(key)) continue
    lines.push(`${key}: ${value.startsWith('[') ? value : quoteIfNeeded(value)}`)
  }
  lines.push(DELIMITER, '')
  const cleanBody = body.replace(/\r\n/g, '\n').replace(/^\n+/, '')
  return `${lines.join('\n')}${cleanBody}${cleanBody.endsWith('\n') ? '' : '\n'}`
}
