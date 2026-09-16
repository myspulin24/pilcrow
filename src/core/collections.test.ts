import { describe, expect, it } from 'vitest'

import {
  addToCollection,
  collectionId,
  collectionsContaining,
  countItems,
  createCollection,
  deleteCollection,
  forgetPath,
  itemLabel,
  makeItem,
  removeFromCollection,
  renameCollection,
  samePath,
  validateCollectionName,
  type Collection,
} from './collections'

const ids = () => {
  let n = 0
  return () => `id${++n}`
}

const base: Collection[] = [
  {
    id: 'c1',
    name: 'Work',
    items: [
      { path: 'notes/plan.md', label: 'plan', external: false },
      { path: 'C:\\Projects\\spec.md', label: 'spec', external: true },
    ],
  },
  { id: 'c2', name: 'Reading', items: [] },
]

describe('validateCollectionName', () => {
  it('accepts a clean name and collapses whitespace', () => {
    expect(validateCollectionName('  Work   stuff ')).toEqual({ ok: true, value: 'Work stuff' })
  })

  it('rejects an empty name', () => {
    expect(validateCollectionName('   ').ok).toBe(false)
  })

  it('rejects a name that is too long', () => {
    const result = validateCollectionName('x'.repeat(61))
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/60/)
  })

  it('rejects a duplicate, case-insensitively', () => {
    const result = validateCollectionName('work', base)
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/už máš/i)
  })

  it('allows a name that only clashes with itself once renamed away', () => {
    expect(validateCollectionName('Archive', base).ok).toBe(true)
  })
})

describe('create / rename / delete', () => {
  it('appends a new empty collection', () => {
    const next = createCollection(base, ' Ideas ', ids())
    expect(next).toHaveLength(3)
    expect(next[2]).toEqual({ id: 'id1', name: 'Ideas', items: [] })
    expect(base).toHaveLength(2)
  })

  it('renames only the one addressed', () => {
    const next = renameCollection(base, 'c2', ' Later ')
    expect(next[1]!.name).toBe('Later')
    expect(next[0]!.name).toBe('Work')
  })

  it('deletes by id and leaves the rest alone', () => {
    expect(deleteCollection(base, 'c1').map((c) => c.id)).toEqual(['c2'])
    expect(deleteCollection(base, 'nope')).toHaveLength(2)
  })

  it('makes ids that do not collide', () => {
    let seed = 1
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const made = new Set(Array.from({ length: 300 }, () => collectionId(1_700_000_000_000, random)))
    expect(made.size).toBe(300)
  })
})

describe('adding and removing files', () => {
  it('adds a file to the addressed collection', () => {
    const next = addToCollection(base, 'c2', makeItem('/docs/api.md', true))
    expect(next[1]!.items).toEqual([{ path: '/docs/api.md', label: 'api', external: true }])
    expect(next[0]!.items).toHaveLength(2)
  })

  it('adding the same file twice is a no-op, not an error', () => {
    const once = addToCollection(base, 'c2', makeItem('/docs/api.md', true))
    const twice = addToCollection(once, 'c2', makeItem('/docs/api.md', true))
    expect(twice[1]!.items).toHaveLength(1)
  })

  it('treats differing separators and case as the same file', () => {
    const next = addToCollection(base, 'c1', makeItem('c:/projects/SPEC.md', true))
    expect(next[0]!.items).toHaveLength(2)
  })

  it('removes a file from one collection only', () => {
    const shared = addToCollection(base, 'c2', makeItem('notes/plan.md', false))
    const next = removeFromCollection(shared, 'c2', 'notes/plan.md')
    expect(next[1]!.items).toHaveLength(0)
    expect(next[0]!.items).toHaveLength(2)
  })

  it('forgets a path everywhere, for when the file itself is deleted', () => {
    const shared = addToCollection(base, 'c2', makeItem('notes/plan.md', false))
    const next = forgetPath(shared, 'notes/plan.md')
    expect(countItems(next)).toBe(1)
  })

  it('reports which collections hold a file', () => {
    expect(collectionsContaining(base, 'C:/Projects/spec.md').map((c) => c.name)).toEqual(['Work'])
    expect(collectionsContaining(base, '/nowhere.md')).toEqual([])
  })

  it('does not mutate the input', () => {
    const before = JSON.stringify(base)
    addToCollection(base, 'c1', makeItem('/x.md', true))
    removeFromCollection(base, 'c1', 'notes/plan.md')
    expect(JSON.stringify(base)).toBe(before)
  })
})

describe('labels and paths', () => {
  it('labels a file by its name without the extension', () => {
    expect(itemLabel('/docs/guides/intro.md')).toBe('intro')
    expect(itemLabel('C:\\notes\\Meeting notes.md')).toBe('Meeting notes')
    expect(makeItem('/a/b.md', true).label).toBe('b')
    expect(makeItem('/a/b.md', true, ' Custom ').label).toBe('Custom')
  })

  it('compares paths the way the file systems do', () => {
    expect(samePath('C:\\a\\b.md', 'c:/A/B.md')).toBe(true)
    expect(samePath('/a/b.md', '/a/c.md')).toBe(false)
    expect(samePath('/a/b/', '/a/b')).toBe(true)
  })

  it('counts every linked file', () => {
    expect(countItems(base)).toBe(2)
    expect(countItems([])).toBe(0)
  })
})
