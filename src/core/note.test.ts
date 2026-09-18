/**
 * Tests for the central transformation: Markdown file text <-> parsed note.
 *
 * This is the code every other part of Pilcrow depends on being right. If
 * frontmatter round-trips lossily, editing a note in Pilcrow quietly corrupts
 * metadata another editor wrote; if tag extraction is wrong, the sidebar lies.
 */

import { describe, expect, it } from 'vitest'

import { serializeNote, splitFrontmatter } from './frontmatter'
import {
  applyBodyEdit,
  buildExcerpt,
  countTasks,
  createNoteFile,
  generateId,
  headingTitle,
  parseNote,
  retitleNote,
  serializeNoteFile,
  setPinned,
  toggleTask,
} from './note'

const FIXED_NOW = () => '2026-09-15T12:00:00.000Z'
const FIXED_RANDOM = () => 0.5

function file(body: string, frontmatter: Record<string, string> = {}): string {
  const fields = {
    id: 'abc123',
    title: 'Test note',
    created: '2026-09-01T09:00:00.000Z',
    updated: '2026-09-01T09:00:00.000Z',
    pinned: 'false',
    tags: '[]',
    ...frontmatter,
  }
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`)
  return `---\n${lines.join('\n')}\n---\n\n${body}`
}

describe('splitFrontmatter', () => {
  it('separates a frontmatter block from the body', () => {
    const raw = splitFrontmatter('---\ntitle: Hi\n---\n\n# Body\n')
    expect(raw.present).toBe(true)
    expect(raw.fields.get('title')).toBe('Hi')
    expect(raw.body).toBe('# Body\n')
  })

  it('treats a document with no frontmatter as all body', () => {
    const raw = splitFrontmatter('# Just a heading\n\ntext')
    expect(raw.present).toBe(false)
    expect(raw.body).toBe('# Just a heading\n\ntext')
  })

  it('does not mistake a horizontal rule mid-document for frontmatter', () => {
    const raw = splitFrontmatter('Some text\n\n---\n\nMore text')
    expect(raw.present).toBe(false)
    expect(raw.body).toContain('Some text')
  })

  it('treats an unterminated block as body rather than swallowing the note', () => {
    const raw = splitFrontmatter('---\ntitle: Oops\n\n# Where is my text')
    expect(raw.present).toBe(false)
    expect(raw.body).toContain('# Where is my text')
  })

  it('reads both inline and block list syntax for tags', () => {
    expect(splitFrontmatter('---\ntags: [a, b]\n---\n').fields.get('tags')).toEqual(['a', 'b'])
    expect(splitFrontmatter('---\ntags:\n  - a\n  - b\n---\n').fields.get('tags')).toEqual(['a', 'b'])
  })

  it('normalises CRLF so files written on Windows parse identically', () => {
    const raw = splitFrontmatter('---\r\ntitle: Hi\r\n---\r\n\r\nBody\r\n')
    expect(raw.fields.get('title')).toBe('Hi')
    expect(raw.body).toBe('Body\n')
  })

  it('unquotes values and keeps colons inside them', () => {
    const raw = splitFrontmatter('---\ntitle: "Meeting: Q4 plan"\n---\n')
    expect(raw.fields.get('title')).toBe('Meeting: Q4 plan')
  })
})

describe('parseNote', () => {
  it('round-trips a note it wrote itself', () => {
    const original = createNoteFile({
      title: 'Round trip',
      body: '# Round trip\n\nSome #tag and a [[Link]].\n',
      now: new Date('2026-09-15T12:00:00.000Z'),
      random: FIXED_RANDOM,
    })
    const parsed = parseNote(original, { path: 'round-trip.md' })
    expect(serializeNoteFile(parsed)).toBe(original)
  })

  it('fills in a title from the first heading when frontmatter has none', () => {
    const parsed = parseNote('# Inferred title\n\nbody', { path: 'some-file.md', now: FIXED_NOW })
    expect(parsed.frontmatter.title).toBe('Inferred title')
  })

  it('falls back to the file name when there is no heading either', () => {
    const parsed = parseNote('just text', { path: 'notes/My File.md', now: FIXED_NOW })
    expect(parsed.frontmatter.title).toBe('My File')
  })

  it('generates an id and timestamps for a file written by another editor', () => {
    const parsed = parseNote('# Foreign\n', { path: 'foreign.md', now: FIXED_NOW, random: FIXED_RANDOM })
    expect(parsed.frontmatter.id).toMatch(/^[a-z0-9]{16}$/)
    expect(parsed.frontmatter.created).toBe('2026-09-15T12:00:00.000Z')
    expect(parsed.frontmatter.updated).toBe('2026-09-15T12:00:00.000Z')
  })

  it('preserves unknown frontmatter keys so another tool does not lose data', () => {
    const source = file('body', { 'obsidian-cssclass': 'wide', aliases: '[Alt name]' })
    const parsed = parseNote(source, { path: 'x.md' })
    expect(parsed.frontmatter.extra['obsidian-cssclass']).toBe('wide')

    const written = serializeNoteFile(parsed)
    expect(written).toContain('obsidian-cssclass: wide')
    expect(written).toContain('aliases: [Alt name]')
  })

  it('merges frontmatter tags with inline tags, sorted and de-duplicated', () => {
    const source = file('Body with #beta and #alpha and #beta again', { tags: '[Alpha, gamma]' })
    expect(parseNote(source, { path: 'x.md' }).tags).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('never throws on pathological input', () => {
    for (const input of ['', '---', '---\n---', '\u0000\u0001', '---\ntags:\n---\n', 'a'.repeat(50_000)]) {
      expect(() => parseNote(input, { path: 'x.md' })).not.toThrow()
    }
  })

  it('reads pinned as a boolean', () => {
    expect(parseNote(file('b', { pinned: 'true' }), { path: 'x.md' }).frontmatter.pinned).toBe(true)
    expect(parseNote(file('b', { pinned: 'false' }), { path: 'x.md' }).frontmatter.pinned).toBe(false)
  })
})

describe('serializeNote', () => {
  it('quotes values that would otherwise be mis-read as YAML', () => {
    const written = serializeNote(
      {
        id: 'x',
        title: 'true',
        created: '2026-09-15T12:00:00.000Z',
        updated: '2026-09-15T12:00:00.000Z',
        pinned: false,
        tags: [],
        extra: {},
      },
      'body',
    )
    expect(written).toContain('title: "true"')
    // An ISO timestamp contains colons and must survive a round trip.
    expect(splitFrontmatter(written).fields.get('created')).toBe('2026-09-15T12:00:00.000Z')
  })

  it('escapes embedded quotes', () => {
    const written = serializeNote(
      {
        id: 'x',
        title: 'She said "hello"',
        created: '',
        updated: '',
        pinned: false,
        tags: [],
        extra: {},
      },
      'body',
    )
    expect(splitFrontmatter(written).fields.get('title')).toBe('She said "hello"')
  })

  it('always ends the file with exactly one trailing newline', () => {
    const base = {
      id: 'x',
      title: 'T',
      created: '',
      updated: '',
      pinned: false,
      tags: [],
      extra: {},
    }
    expect(serializeNote(base, 'no newline')).toMatch(/no newline\n$/)
    expect(serializeNote(base, 'has newline\n')).toMatch(/has newline\n$/)
  })
})

describe('derived fields', () => {
  it('counts tasks, including ordered and indented ones', () => {
    const body = ['- [ ] one', '- [x] two', '  - [X] nested done', '1. [ ] ordered', '- not a task'].join('\n')
    expect(countTasks(body)).toEqual({ total: 4, done: 2 })
  })

  it('builds a plain-text excerpt without Markdown syntax', () => {
    const body = [
      '# Heading',
      '',
      '**Bold** and `code` and [a link](https://example.com).',
      '',
      '- [ ] a task',
      '',
      '```js',
      'const secret = 1',
      '```',
    ].join('\n')

    const excerpt = buildExcerpt(body)
    expect(excerpt).toContain('Bold and code and a link')
    expect(excerpt).not.toContain('**')
    expect(excerpt).not.toContain('const secret')
  })

  it('shows the alias of a wiki link in the excerpt', () => {
    expect(buildExcerpt('See [[some-file|the other note]] for detail.')).toBe(
      'See the other note for detail.',
    )
  })

  it('truncates long excerpts on a word boundary', () => {
    const excerpt = buildExcerpt('lorem ipsum '.repeat(60))
    expect(excerpt.length).toBeLessThanOrEqual(184)
    expect(excerpt.endsWith('...')).toBe(true)
  })

  it('finds a heading title only near the top of the note', () => {
    expect(headingTitle('# Top\n\nbody')).toBe('Top')
    expect(headingTitle('a\nb\nc\nd\ne\nf\n# Late heading')).toBeNull()
    // `#tag` is not a heading.
    expect(headingTitle('#nothing\n')).toBeNull()
  })
})

describe('toggleTask', () => {
  const body = ['- [ ] first', '- [x] second', '  - [ ] third'].join('\n')

  it('toggles the addressed checkbox and leaves the others alone', () => {
    expect(toggleTask(body, 0)).toBe(['- [x] first', '- [x] second', '  - [ ] third'].join('\n'))
    expect(toggleTask(body, 1)).toBe(['- [ ] first', '- [ ] second', '  - [ ] third'].join('\n'))
    expect(toggleTask(body, 2)).toBe(['- [ ] first', '- [x] second', '  - [x] third'].join('\n'))
  })

  it('is a no-op for an index that does not exist', () => {
    // A stale render must never be able to corrupt a file.
    expect(toggleTask(body, 9)).toBe(body)
    expect(toggleTask(body, -1)).toBe(body)
  })
})

describe('editing helpers', () => {
  it('applyBodyEdit refreshes updated and derived tags', () => {
    const parsed = parseNote(file('original'), { path: 'x.md' })
    const next = applyBodyEdit(parsed, 'now with #newtag', new Date('2026-09-15T12:00:00.000Z'))

    expect(next.frontmatter.updated).toBe('2026-09-15T12:00:00.000Z')
    expect(next.frontmatter.created).toBe('2026-09-01T09:00:00.000Z')
    expect(next.tags).toEqual(['newtag'])
  })

  it('retitleNote updates the frontmatter and the leading heading together', () => {
    const parsed = parseNote(file('# Old title\n\nbody'), { path: 'x.md' })
    const next = retitleNote(parsed, 'New title')

    expect(next.frontmatter.title).toBe('New title')
    expect(next.body).toContain('# New title')
    expect(next.body).not.toContain('# Old title')
  })

  it('retitleNote leaves the body alone when there is no leading heading', () => {
    const parsed = parseNote(file('just prose'), { path: 'x.md' })
    const next = retitleNote(parsed, 'New title')
    expect(next.body.trim()).toBe('just prose')
    expect(next.frontmatter.title).toBe('New title')
  })

  it('retitleNote handles titles containing $ without mangling them', () => {
    const parsed = parseNote(file('# Old\n'), { path: 'x.md' })
    expect(retitleNote(parsed, 'Cost: $5 & $10').body).toContain('# Cost: $5 & $10')
  })

  it('setPinned flips the flag and stamps updated', () => {
    const parsed = parseNote(file('body'), { path: 'x.md' })
    const pinned = setPinned(parsed, true, new Date('2026-09-15T12:00:00.000Z'))
    expect(pinned.frontmatter.pinned).toBe(true)
    expect(pinned.frontmatter.updated).toBe('2026-09-15T12:00:00.000Z')
  })
})

describe('generateId', () => {
  it('produces a 16-character sortable id', () => {
    const early = generateId(1_000_000_000_000, FIXED_RANDOM)
    const late = generateId(2_000_000_000_000, FIXED_RANDOM)
    expect(early).toHaveLength(16)
    expect(late).toHaveLength(16)
    expect(early < late).toBe(true)
  })

  it('does not collide across calls at the same instant', () => {
    let seed = 0
    const random = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280)
    const ids = new Set(Array.from({ length: 500 }, () => generateId(1_700_000_000_000, random)))
    expect(ids.size).toBe(500)
  })
})
