import { describe, expect, it } from 'vitest'

import {
  collapseDiff,
  conflictCopyPath,
  decideExternalChange,
  diffLines,
  summarizeDiff,
  type DiffLine,
} from './conflict'
import { hashText } from './hash'

const texts = (diff: DiffLine[], kind: DiffLine['kind']) =>
  diff.filter((line) => line.kind === kind).map((line) => line.text)

describe('diffLines', () => {
  it('reports identical input as entirely unchanged', () => {
    const diff = diffLines('a\nb\nc', 'a\nb\nc')
    expect(summarizeDiff(diff)).toEqual({ added: 0, removed: 0, unchanged: 3, identical: true })
  })

  it('detects an inserted line', () => {
    const diff = diffLines('a\nc', 'a\nb\nc')
    expect(texts(diff, 'added')).toEqual(['b'])
    expect(texts(diff, 'removed')).toEqual([])
  })

  it('detects a deleted line', () => {
    const diff = diffLines('a\nb\nc', 'a\nc')
    expect(texts(diff, 'removed')).toEqual(['b'])
  })

  it('reports a changed line as one removal and one addition', () => {
    const diff = diffLines('a\nold\nc', 'a\nnew\nc')
    expect(texts(diff, 'removed')).toEqual(['old'])
    expect(texts(diff, 'added')).toEqual(['new'])
  })

  it('numbers lines independently on each side', () => {
    const diff = diffLines('a\nb', 'a\nx\nb')
    const added = diff.find((line) => line.kind === 'added')!
    expect(added.leftNumber).toBeNull()
    expect(added.rightNumber).toBe(2)
  })

  it('normalises CRLF so a line-ending change is not a whole-file conflict', () => {
    expect(summarizeDiff(diffLines('a\r\nb\r\n', 'a\nb\n')).identical).toBe(true)
  })

  it('handles one side being empty', () => {
    expect(texts(diffLines('', 'a\nb'), 'added')).toEqual(['a', 'b'])
    expect(texts(diffLines('a\nb', ''), 'removed')).toEqual(['a', 'b'])
  })

  it('falls back to a whole-file replace beyond the line budget', () => {
    const big = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n')
    const diff = diffLines(big, `${big}\nextra`, 10)
    expect(summarizeDiff(diff).unchanged).toBe(0)
    expect(summarizeDiff(diff).removed).toBe(30)
  })
})

describe('collapseDiff', () => {
  it('hides long runs of unchanged lines but keeps context', () => {
    const left = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n')
    const right = left.replace('line 20', 'CHANGED')
    const rows = collapseDiff(diffLines(left, right), 2)

    const skipped = rows.filter((row) => 'skipped' in row)
    expect(skipped.length).toBeGreaterThan(0)
    expect(rows.some((row) => !('skipped' in row) && row.text === 'CHANGED')).toBe(true)
    expect(rows.some((row) => !('skipped' in row) && row.text === 'line 19')).toBe(true)
    expect(rows.some((row) => !('skipped' in row) && row.text === 'line 5')).toBe(false)
  })

  it('collapses an identical file into a single skip marker', () => {
    const same = 'a\nb\nc\nd\ne'
    expect(collapseDiff(diffLines(same, same))).toEqual([{ skipped: 5 }])
  })
})

describe('conflictCopyPath', () => {
  it('builds a dated sidecar name next to the original', () => {
    const when = new Date('2026-09-15T12:34:56.000Z')
    expect(conflictCopyPath('daily/2026-09-15.md', when)).toBe(
      'daily/2026-09-15 (conflicted copy 2026-09-15T12-34-56).md',
    )
  })

  it('works for a file with no extension', () => {
    const when = new Date('2026-09-15T12:34:56.000Z')
    expect(conflictCopyPath('note', when)).toBe('note (conflicted copy 2026-09-15T12-34-56)')
  })
})

describe('decideExternalChange', () => {
  const base = hashText('original')
  const disk = hashText('from another device')

  it('ignores a change that matches what we already had', () => {
    expect(decideExternalChange({ baseHash: base, diskHash: base, dirty: false })).toBe('ignore')
    expect(decideExternalChange({ baseHash: base, diskHash: base, dirty: true })).toBe('ignore')
  })

  it('reloads silently when there are no unsaved edits', () => {
    expect(decideExternalChange({ baseHash: base, diskHash: disk, dirty: false })).toBe('reload')
  })

  it('raises a conflict when both sides changed', () => {
    expect(
      decideExternalChange({
        baseHash: base,
        diskHash: disk,
        dirty: true,
        localHash: hashText('my unsaved edit'),
      }),
    ).toBe('conflict')
  })

  it('reloads rather than conflicting when both sides made the same edit', () => {
    expect(
      decideExternalChange({ baseHash: base, diskHash: disk, dirty: true, localHash: disk }),
    ).toBe('reload')
  })
})
