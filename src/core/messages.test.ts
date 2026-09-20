import { describe, expect, it } from 'vitest'

import { plural, t, withCount } from './messages'

describe('plural', () => {
  it('uses the singular for exactly one', () => {
    expect(plural(1, 'poznámka', 'poznámky', 'poznámek')).toBe('poznámka')
  })

  it('uses the two-to-four form', () => {
    for (const n of [2, 3, 4]) {
      expect(plural(n, 'poznámka', 'poznámky', 'poznámek')).toBe('poznámky')
    }
  })

  it('uses the many form for zero and for five upwards', () => {
    for (const n of [0, 5, 11, 21, 100]) {
      expect(plural(n, 'poznámka', 'poznámky', 'poznámek')).toBe('poznámek')
    }
  })

  it('ignores sign and fraction, so a stray -1 or 1.4 still reads correctly', () => {
    expect(plural(-1, 'soubor', 'soubory', 'souborů')).toBe('soubor')
    expect(plural(1.4, 'soubor', 'soubory', 'souborů')).toBe('soubor')
    expect(plural(-7, 'soubor', 'soubory', 'souborů')).toBe('souborů')
  })
})

describe('withCount', () => {
  it('puts the number in front of the right form', () => {
    expect(withCount(0, 'soubor', 'soubory', 'souborů')).toBe('0 souborů')
    expect(withCount(1, 'soubor', 'soubory', 'souborů')).toBe('1 soubor')
    expect(withCount(3, 'soubor', 'soubory', 'souborů')).toBe('3 soubory')
    expect(withCount(9, 'soubor', 'soubory', 'souborů')).toBe('9 souborů')
  })
})

describe('the catalogue', () => {
  it('declines counted nouns correctly wherever a count appears', () => {
    expect(t.status.notes(1)).toBe('1 poznámka')
    expect(t.status.notes(3)).toBe('3 poznámky')
    expect(t.status.notes(8)).toBe('8 poznámek')

    expect(t.workspace.files_(1)).toBe('1 soubor')
    expect(t.workspace.files_(4)).toBe('4 soubory')
    expect(t.workspace.files_(12)).toBe('12 souborů')

    expect(t.note.words(1)).toBe('1 slovo')
    expect(t.note.words(2)).toBe('2 slova')
    expect(t.note.words(102)).toBe('102 slov')

    expect(t.backlinks.count(1)).toBe('1 zmínka')
    expect(t.backlinks.count(2)).toBe('2 zmínky')
    expect(t.backlinks.count(0)).toBe('0 zmínek')
  })

  it('agrees the verb with the count when links are rewritten', () => {
    expect(t.toast.renamedWithLinks('Plán', 1)).toContain('1 odkazující poznámka')
    expect(t.toast.renamedWithLinks('Plán', 3)).toContain('3 odkazující poznámky')
    expect(t.toast.renamedWithLinks('Plán', 7)).toContain('7 odkazujících poznámek')
  })

  it('has no English left in the strings it exposes', () => {
    // A blunt check, but it catches a forgotten key: every leaf is either a
    // string or a function, and the plain strings must not be English words we
    // know we removed.
    const forbidden = /\b(note|file|folder|group|search|delete|cancel|open|close|preview)\b/i
    const offenders: string[] = []

    const walk = (value: unknown, path: string) => {
      if (typeof value === 'string') {
        // The app's own name and code identifiers are allowed through.
        if (path === 'app.name' || path.startsWith('browser.warning')) return
        if (forbidden.test(value)) offenders.push(`${path}: ${value}`)
        return
      }
      if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) walk(child, path ? `${path}.${key}` : key)
      }
    }
    walk(t, '')

    expect(offenders).toEqual([])
  })
})

describe('hlášky o stavu proti GitHubu', () => {
  it('mají správný slovosled pro všechny tvary čísla', () => {
    // `withCount` dává číslo před slovo, což u slovesa nefunguje --
    // vzniklo tím „Na GitHubu 6 je novějších commitů“.
    expect(t.git.behind(1)).toBe('Na GitHubu je 1 novější commit.')
    expect(t.git.behind(3)).toBe('Na GitHubu jsou 3 novější commity.')
    expect(t.git.behind(6)).toBe('Na GitHubu je 6 novějších commitů.')
    expect(t.git.behind(0)).toBe('Na GitHubu je 0 novějších commitů.')
  })

  it('neodeslané commity se skloňují taky', () => {
    expect(t.git.syncAhead(1)).toBe('Máš 1 neodeslaný commit.')
    expect(t.git.syncAhead(3)).toBe('Máš 3 neodeslané commity.')
    expect(t.git.syncAhead(6)).toBe('Máš 6 neodeslaných commitů.')
  })
})
