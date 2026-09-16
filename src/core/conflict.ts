/**
 * Conflict detection and the line diff behind the conflict-resolution view.
 *
 * Because Markdown files are the source of truth, anything can change them:
 * iCloud Drive syncing a copy from an iPhone, a text editor, a git checkout.
 * Reader_MJ never silently overwrites. Every write carries the hash the editor
 * loaded from; if the file on disk no longer matches, the write is refused and
 * the user is shown both versions.
 */

export type DiffKind = 'same' | 'added' | 'removed'

export interface DiffLine {
  kind: DiffKind
  /** 1-based line number on the left (disk) side, or null for added lines. */
  leftNumber: number | null
  /** 1-based line number on the right (local) side, or null for removed lines. */
  rightNumber: number | null
  text: string
}

/**
 * Longest-common-subsequence line diff.
 *
 * Bounded on purpose: for inputs past `maxLines` we fall back to a whole-file
 * replace block, because a personal notes app should never freeze rendering a
 * diff of a pasted 50k-line log.
 */
export function diffLines(left: string, right: string, maxLines = 2000): DiffLine[] {
  const a = left.replace(/\r\n/g, '\n').split('\n')
  const b = right.replace(/\r\n/g, '\n').split('\n')

  if (a.length > maxLines || b.length > maxLines) {
    return [
      ...a.map((text, i) => ({ kind: 'removed' as const, leftNumber: i + 1, rightNumber: null, text })),
      ...b.map((text, i) => ({ kind: 'added' as const, leftNumber: null, rightNumber: i + 1, text })),
    ]
  }

  // Classic LCS table. a.length * b.length is capped by maxLines above.
  const rows = a.length + 1
  const columns = b.length + 1
  const table: Uint32Array = new Uint32Array(rows * columns)

  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * columns + j] =
        a[i] === b[j]
          ? (table[(i + 1) * columns + (j + 1)] ?? 0) + 1
          : Math.max(table[(i + 1) * columns + j] ?? 0, table[i * columns + (j + 1)] ?? 0)
    }
  }

  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', leftNumber: i + 1, rightNumber: j + 1, text: a[i] ?? '' })
      i += 1
      j += 1
    } else if ((table[(i + 1) * columns + j] ?? 0) >= (table[i * columns + (j + 1)] ?? 0)) {
      out.push({ kind: 'removed', leftNumber: i + 1, rightNumber: null, text: a[i] ?? '' })
      i += 1
    } else {
      out.push({ kind: 'added', leftNumber: null, rightNumber: j + 1, text: b[j] ?? '' })
      j += 1
    }
  }
  while (i < a.length) {
    out.push({ kind: 'removed', leftNumber: i + 1, rightNumber: null, text: a[i] ?? '' })
    i += 1
  }
  while (j < b.length) {
    out.push({ kind: 'added', leftNumber: null, rightNumber: j + 1, text: b[j] ?? '' })
    j += 1
  }
  return out
}

export interface DiffSummary {
  added: number
  removed: number
  unchanged: number
  /** True when the two sides are byte-identical after newline normalisation. */
  identical: boolean
}

export function summarizeDiff(diff: DiffLine[]): DiffSummary {
  let added = 0
  let removed = 0
  let unchanged = 0
  for (const line of diff) {
    if (line.kind === 'added') added += 1
    else if (line.kind === 'removed') removed += 1
    else unchanged += 1
  }
  return { added, removed, unchanged, identical: added === 0 && removed === 0 }
}

/**
 * Collapse long runs of unchanged lines so the conflict view stays readable.
 * Returns groups, where a `null` entry marks "N lines skipped".
 */
export function collapseDiff(diff: DiffLine[], context = 3): Array<DiffLine | { skipped: number }> {
  const keep = new Set<number>()
  diff.forEach((line, index) => {
    if (line.kind === 'same') return
    for (let i = index - context; i <= index + context; i++) {
      if (i >= 0 && i < diff.length) keep.add(i)
    }
  })

  const out: Array<DiffLine | { skipped: number }> = []
  let skipped = 0
  diff.forEach((line, index) => {
    if (keep.has(index)) {
      if (skipped > 0) {
        out.push({ skipped })
        skipped = 0
      }
      out.push(line)
    } else {
      skipped += 1
    }
  })
  if (skipped > 0) out.push({ skipped })
  return out
}

/**
 * Name for the sidecar file written when the user keeps both versions.
 * Mirrors the shape iCloud Drive itself uses, so the pattern is familiar.
 */
export function conflictCopyPath(path: string, now: Date = new Date(), label = 'conflicted copy'): string {
  const stamp = now.toISOString().slice(0, 19).replace(/:/g, '-')
  const dot = path.lastIndexOf('.')
  const stem = dot === -1 ? path : path.slice(0, dot)
  const extension = dot === -1 ? '' : path.slice(dot)
  return `${stem} (${label} ${stamp})${extension}`
}

/**
 * Decide whether a change noticed by the file watcher needs the user's
 * attention or can be absorbed silently.
 *
 * - The editor has no unsaved edits  -> reload silently.
 * - The file matches what we wrote   -> ignore, it was our own write.
 * - Otherwise                        -> conflict.
 */
export type ExternalChangeDecision = 'ignore' | 'reload' | 'conflict'

export function decideExternalChange(input: {
  /** Hash the buffer was loaded from. */
  baseHash: string
  /** Hash of the file as it is now on disk. */
  diskHash: string
  /** True when the editor buffer differs from what was loaded. */
  dirty: boolean
  /** Hash of the buffer's current contents, when dirty. */
  localHash?: string
}): ExternalChangeDecision {
  if (input.diskHash === input.baseHash) return 'ignore'
  if (!input.dirty) return 'reload'
  // Someone else made exactly the edit we were about to make.
  if (input.localHash && input.localHash === input.diskHash) return 'reload'
  return 'conflict'
}
