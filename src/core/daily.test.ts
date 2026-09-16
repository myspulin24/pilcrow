import { describe, expect, it } from 'vitest'

import { dailyNotePath, dailyNoteTemplate, dailyNoteTitle, localDateKey, parseDateKey } from './daily'
import { parseNote } from './note'

describe('localDateKey', () => {
  it('uses local time, not UTC', () => {
    // A daily note is about the user's day, so 23:30 local is still today even
    // when UTC has already rolled over.
    const date = new Date(2026, 8, 15, 23, 30)
    expect(localDateKey(date)).toBe('2026-09-15')
  })

  it('zero-pads months and days', () => {
    expect(localDateKey(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('parseDateKey', () => {
  it('round-trips with localDateKey', () => {
    const date = new Date(2026, 8, 15)
    expect(localDateKey(parseDateKey(localDateKey(date))!)).toBe('2026-09-15')
  })

  it('rejects anything that is not a date key', () => {
    expect(parseDateKey('not a date')).toBeNull()
    expect(parseDateKey('2026-9-5')).toBeNull()
    expect(parseDateKey('')).toBeNull()
  })
})

describe('dailyNotePath', () => {
  it('places the note in the configured folder', () => {
    const date = new Date(2026, 8, 15)
    expect(dailyNotePath(date, 'daily')).toBe('daily/2026-09-15.md')
    expect(dailyNotePath(date, 'journal/2026')).toBe('journal/2026/2026-09-15.md')
  })

  it('falls back to the vault root when the folder is blank', () => {
    expect(dailyNotePath(new Date(2026, 8, 15), '')).toBe('2026-09-15.md')
  })

  it('sanitises a hostile folder setting', () => {
    expect(dailyNotePath(new Date(2026, 8, 15), '../escape')).toBe('escape/2026-09-15.md')
  })
})

describe('dailyNoteTitle', () => {
  it('reads as a date a Czech reader would write, with the month in the genitive', () => {
    expect(dailyNoteTitle(new Date(2026, 8, 15))).toBe('úterý 15. září 2026')
    expect(dailyNoteTitle(new Date(2026, 0, 1))).toBe('čtvrtek 1. ledna 2026')
  })
})

describe('dailyNoteTemplate', () => {
  const date = new Date(2026, 8, 15)
  const parsed = parseNote(dailyNoteTemplate(date), { path: 'daily/2026-09-15.md' })

  it('produces a valid note with the date as its title', () => {
    expect(parsed.frontmatter.title).toBe('2026-09-15')
    expect(parsed.frontmatter.id).toHaveLength(16)
  })

  it('carries the daily tag', () => {
    expect(parsed.tags).toContain('daily')
  })

  it('links to yesterday and tomorrow', () => {
    const targets = parsed.links.map((link) => link.target)
    expect(targets).toContain('2026-09-14')
    expect(targets).toContain('2026-09-16')
  })

  it('starts with an empty task ready to type into', () => {
    expect(parsed.tasks).toEqual({ total: 1, done: 0 })
  })
})
