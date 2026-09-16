import { describe, expect, it } from 'vitest'

import {
  buildSnippet,
  fuzzyScore,
  parseSearchQuery,
  scoreNote,
  searchNotes,
  toFtsExpression,
  tokenize,
  type SearchableNote,
} from './search-query'

describe('tokenize', () => {
  it('splits on whitespace and keeps quoted phrases together', () => {
    expect(tokenize('one two')).toEqual(['one', 'two'])
    expect(tokenize('"a phrase" solo')).toEqual(['a phrase', 'solo'])
    expect(tokenize('   ')).toEqual([])
  })
})

describe('parseSearchQuery', () => {
  it('treats an empty query as empty', () => {
    expect(parseSearchQuery('').isEmpty).toBe(true)
    expect(parseSearchQuery('   ').isEmpty).toBe(true)
  })

  it('extracts tag filters and leaves the rest as text', () => {
    const query = parseSearchQuery('tag:work/acme quarterly plan')
    expect(query.tags).toEqual(['work/acme'])
    expect(query.text).toBe('quarterly plan')
    expect(query.isEmpty).toBe(false)
  })

  it('supports negated tags', () => {
    const query = parseSearchQuery('-tag:archive notes')
    expect(query.excludeTags).toEqual(['archive'])
    expect(query.tags).toEqual([])
  })

  it('supports a bare #tag', () => {
    expect(parseSearchQuery('#idea').tags).toEqual(['idea'])
  })

  it('supports is:pinned and has:tasks', () => {
    expect(parseSearchQuery('is:pinned').pinnedOnly).toBe(true)
    expect(parseSearchQuery('has:tasks').hasTasks).toBe(true)
    expect(parseSearchQuery('-is:pinned').pinnedOnly).toBe(false)
  })

  it('keeps a colon inside ordinary text', () => {
    expect(parseSearchQuery('meeting: notes').text).toBe('meeting: notes')
  })

  it('normalises tag case', () => {
    expect(parseSearchQuery('tag:Work/ACME').tags).toEqual(['work/acme'])
  })
})

describe('toFtsExpression', () => {
  it('quotes every term and adds a prefix wildcard', () => {
    expect(toFtsExpression(parseSearchQuery('hello world'))).toBe('"hello"* AND "world"*')
  })

  it('returns null when there is nothing full-text to match', () => {
    expect(toFtsExpression(parseSearchQuery('tag:work'))).toBeNull()
    expect(toFtsExpression(parseSearchQuery('*'))).toBeNull()
  })
})

const NOTES: SearchableNote[] = [
  {
    path: 'acme.md',
    title: 'Acme kickoff',
    body: 'Discussed the quarterly plan with the Acme team.',
    tags: ['work/clients/acme'],
    pinned: false,
    hasTasks: true,
    updated: '2026-09-10T00:00:00.000Z',
  },
  {
    path: 'quarterly.md',
    title: 'Quarterly review',
    body: 'Numbers look fine.',
    tags: ['work/admin'],
    pinned: true,
    hasTasks: false,
    updated: '2026-09-01T00:00:00.000Z',
  },
  {
    path: 'groceries.md',
    title: 'Groceries',
    body: 'Apples, oranges, quarterly oats.',
    tags: ['home'],
    pinned: false,
    hasTasks: false,
    updated: '2026-09-14T00:00:00.000Z',
  },
]

describe('scoreNote', () => {
  it('ranks a title match above a body match', () => {
    const inTitle = scoreNote(NOTES[1]!, parseSearchQuery('quarterly'))
    const inBody = scoreNote(NOTES[2]!, parseSearchQuery('quarterly'))
    expect(inTitle!.score).toBeGreaterThan(inBody!.score)
  })

  it('requires every term to match somewhere', () => {
    expect(scoreNote(NOTES[0]!, parseSearchQuery('acme quarterly'))).not.toBeNull()
    expect(scoreNote(NOTES[0]!, parseSearchQuery('acme nonexistent'))).toBeNull()
  })

  it('matches a parent tag against a child tag', () => {
    expect(scoreNote(NOTES[0]!, parseSearchQuery('tag:work'))).not.toBeNull()
    expect(scoreNote(NOTES[2]!, parseSearchQuery('tag:work'))).toBeNull()
  })

  it('honours exclusions, pinned and task filters', () => {
    expect(scoreNote(NOTES[0]!, parseSearchQuery('-tag:work'))).toBeNull()
    expect(scoreNote(NOTES[0]!, parseSearchQuery('is:pinned'))).toBeNull()
    expect(scoreNote(NOTES[1]!, parseSearchQuery('is:pinned'))).not.toBeNull()
    expect(scoreNote(NOTES[0]!, parseSearchQuery('has:tasks'))).not.toBeNull()
    expect(scoreNote(NOTES[1]!, parseSearchQuery('has:tasks'))).toBeNull()
  })

  it('is case-insensitive', () => {
    expect(scoreNote(NOTES[0]!, parseSearchQuery('ACME'))).not.toBeNull()
  })

  it('produces a highlighted snippet for a body hit', () => {
    const scored = scoreNote(NOTES[2]!, parseSearchQuery('oranges'))
    expect(scored!.snippet).toContain('<mark>oranges</mark>')
  })
})

describe('searchNotes', () => {
  it('returns best matches first', () => {
    const results = searchNotes(NOTES, parseSearchQuery('quarterly'))
    expect(results).toHaveLength(3)
    expect(results[0]!.note.title).toBe('Quarterly review')
  })

  it('breaks ties by most recently updated', () => {
    const results = searchNotes(NOTES, parseSearchQuery('tag:work'))
    expect(results.map((result) => result.note.path)).toEqual(['quarterly.md', 'acme.md'])
  })

  it('returns everything for a filter-only query', () => {
    expect(searchNotes(NOTES, parseSearchQuery('')).length).toBe(3)
  })
})

describe('buildSnippet', () => {
  it('escapes HTML before highlighting', () => {
    const snippet = buildSnippet('a <script> tag and a term', 22, ['term'])
    expect(snippet).toContain('&lt;script&gt;')
    expect(snippet).toContain('<mark>term</mark>')
  })

  it('handles a term containing regex metacharacters', () => {
    expect(() => buildSnippet('cost is $5 (a lot)', 8, ['$5 (a'])).not.toThrow()
  })
})

describe('fuzzyScore', () => {
  it('matches a subsequence and rejects a non-match', () => {
    expect(fuzzyScore('nn', 'New note')).not.toBeNull()
    expect(fuzzyScore('zzz', 'New note')).toBeNull()
  })

  it('prefers word-boundary and consecutive matches', () => {
    const boundary = fuzzyScore('rn', 'Rebuild note')!
    const scattered = fuzzyScore('rn', 'Rearrange nothing important at all')!
    expect(boundary).toBeGreaterThan(scattered)
  })

  it('treats an empty pattern as a neutral match', () => {
    expect(fuzzyScore('', 'anything')).toBe(0)
  })

  it('ignores spaces in the pattern', () => {
    expect(fuzzyScore('new n', 'New note')).not.toBeNull()
  })
})

describe('Czech spellings of the operators', () => {
  it('accepts stitek: and štítek: alongside tag:', () => {
    expect(parseSearchQuery('stitek:prace').tags).toEqual(['prace'])
    expect(parseSearchQuery('štítek:práce').tags).toEqual(['práce'])
    expect(parseSearchQuery('-stitek:archiv').excludeTags).toEqual(['archiv'])
  })

  it('accepts je:pripnute alongside is:pinned', () => {
    expect(parseSearchQuery('je:pripnute').pinnedOnly).toBe(true)
    expect(parseSearchQuery('je:připnuté').pinnedOnly).toBe(true)
    expect(parseSearchQuery('-je:pripnute').pinnedOnly).toBe(false)
  })

  it('accepts ma:ukoly alongside has:tasks', () => {
    expect(parseSearchQuery('ma:ukoly').hasTasks).toBe(true)
    expect(parseSearchQuery('má:úkoly').hasTasks).toBe(true)
  })

  it('still understands the English spellings', () => {
    expect(parseSearchQuery('tag:work').tags).toEqual(['work'])
    expect(parseSearchQuery('is:pinned').pinnedOnly).toBe(true)
    expect(parseSearchQuery('has:tasks').hasTasks).toBe(true)
  })

  it('does not swallow an ordinary word that happens to contain a colon', () => {
    expect(parseSearchQuery('schuzka: poznamky').text).toBe('schuzka: poznamky')
  })
})
