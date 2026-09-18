/**
 * Tag extraction and normalisation.
 *
 * Pilcrow uses Bear-style inline tags: `#idea`, `#work/clients/acme`. A tag is a
 * `#` that is not preceded by a word character (so `C#` is not a tag, and
 * `# Heading` is not either because a heading has a space after the hash),
 * followed by a letter, then letters/digits/`-`/`_`/`/`.
 */

import { maskCode } from './mask'

/** Characters that may never appear in a tag. */
const TAG_BODY = String.raw`[\p{L}\p{N}_-]`
const INLINE_TAG = new RegExp(
  String.raw`(^|[^\p{L}\p{N}_&/#])#(\p{L}${TAG_BODY}*(?:/${TAG_BODY}+)*)`,
  'gu',
)

export interface FoundTag {
  tag: string
  start: number
  end: number
}

/**
 * Normalise a tag: strip leading `#`, collapse slashes, lowercase, and drop
 * trailing punctuation. Returns `''` when nothing valid remains.
 */
export function normalizeTag(input: string): string {
  const stripped = input
    .trim()
    .replace(/^#+/, '')
    .replace(/[.,;:!?)\]]+$/, '')
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase()
  if (!stripped) return ''
  const segments = stripped
    .split('/')
    .map((segment) => segment.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, ''))
    .filter(Boolean)
  if (segments.length === 0) return ''
  // A tag must start with a letter so that `#404` and `#fff` in prose do not
  // silently become tags.
  if (!/^\p{L}/u.test(segments[0]!)) return ''
  return segments.join('/')
}

/** Find every inline `#tag` in body text, skipping code and URLs. */
export function findInlineTags(body: string): FoundTag[] {
  const mask = maskCode(body)
  const found: FoundTag[] = []
  let match: RegExpExecArray | null
  INLINE_TAG.lastIndex = 0
  while ((match = INLINE_TAG.exec(mask)) !== null) {
    const prefix = match[1] ?? ''
    const start = match.index + prefix.length
    const raw = match[2] ?? ''
    const tag = normalizeTag(raw)
    if (!tag) continue
    found.push({ tag, start, end: start + raw.length + 1 })
    // Allow adjacent tags separated by a single space to both match.
    INLINE_TAG.lastIndex = start + raw.length + 1
  }
  return found
}

/** Merge frontmatter tags with inline tags: normalised, de-duplicated, sorted. */
export function collectTags(frontmatterTags: string[], body: string): string[] {
  const set = new Set<string>()
  for (const tag of frontmatterTags) {
    const normalised = normalizeTag(tag)
    if (normalised) set.add(normalised)
  }
  for (const { tag } of findInlineTags(body)) set.add(tag)
  return [...set].sort((a, b) => a.localeCompare(b))
}

/** Expand `a/b/c` into `a`, `a/b`, `a/b/c` so parent tags match children. */
export function expandTagAncestors(tag: string): string[] {
  const segments = tag.split('/')
  const out: string[] = []
  for (let i = 1; i <= segments.length; i++) out.push(segments.slice(0, i).join('/'))
  return out
}

export interface TagNode {
  name: string
  path: string
  count: number
  children: TagNode[]
}

/** Build the nested tag tree shown in the sidebar. Counts are inclusive. */
export function buildTagTree(tagLists: string[][]): TagNode[] {
  const counts = new Map<string, number>()
  for (const tags of tagLists) {
    const seen = new Set<string>()
    for (const tag of tags) {
      for (const ancestor of expandTagAncestors(tag)) seen.add(ancestor)
    }
    for (const path of seen) counts.set(path, (counts.get(path) ?? 0) + 1)
  }

  const roots: TagNode[] = []
  const byPath = new Map<string, TagNode>()
  const paths = [...counts.keys()].sort()

  for (const path of paths) {
    const segments = path.split('/')
    const node: TagNode = {
      name: segments[segments.length - 1]!,
      path,
      count: counts.get(path) ?? 0,
      children: [],
    }
    byPath.set(path, node)
    if (segments.length === 1) {
      roots.push(node)
    } else {
      const parentPath = segments.slice(0, -1).join('/')
      const parent = byPath.get(parentPath)
      if (parent) parent.children.push(node)
      else roots.push(node)
    }
  }
  return roots
}

/** Rename a tag (and its descendants) inside body text. */
export function renameTagInBody(body: string, from: string, to: string): string {
  const source = normalizeTag(from)
  const target = normalizeTag(to)
  if (!source || !target || source === target) return body

  const found = findInlineTags(body).filter(
    (item) => item.tag === source || item.tag.startsWith(`${source}/`),
  )
  if (found.length === 0) return body

  let result = ''
  let cursor = 0
  for (const item of found) {
    result += body.slice(cursor, item.start)
    const suffix = item.tag.slice(source.length)
    result += `#${target}${suffix}`
    cursor = item.end
  }
  result += body.slice(cursor)
  return result
}
