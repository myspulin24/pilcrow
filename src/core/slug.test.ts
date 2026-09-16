import { describe, expect, it } from 'vitest'

import {
  isPathInsideVault,
  joinNotePath,
  safeAttachmentName,
  safeFileName,
  safeFolderPath,
  safeNotePath,
  titleFromPath,
  uniquePath,
  validateNoteName,
} from './slug'

describe('safeFileName', () => {
  it('leaves an already-safe name alone', () => {
    expect(safeFileName('Reading list')).toBe('Reading list')
    expect(safeFileName('2026-09-15')).toBe('2026-09-15')
  })

  it('replaces characters that Windows or macOS refuse', () => {
    expect(safeFileName('a/b')).toBe('a-b')
    expect(safeFileName('what? really!')).toBe('what- really!')
    expect(safeFileName('a:b*c|d')).toBe('a-b-c-d')
  })

  it('strips leading and trailing dots and spaces', () => {
    // Windows silently drops these, which would desync the index from disk.
    expect(safeFileName('  spaced  ')).toBe('spaced')
    expect(safeFileName('.hidden')).toBe('hidden')
    expect(safeFileName('trailing.')).toBe('trailing')
  })

  it('escapes reserved DOS device names', () => {
    expect(safeFileName('CON')).toBe('CON-note')
    expect(safeFileName('lpt1')).toBe('lpt1-note')
    expect(safeFileName('console')).toBe('console')
  })

  it('truncates very long names without leaving a trailing dot', () => {
    const name = safeFileName(`${'a'.repeat(130)}.`)
    expect(name.length).toBeLessThanOrEqual(120)
    expect(name.endsWith('.')).toBe(false)
  })

  it('falls back when nothing usable is left', () => {
    expect(safeFileName('')).toBe('bez-nazvu')
    expect(safeFileName('   ')).toBe('bez-nazvu')
    expect(safeFileName('...')).toBe('bez-nazvu')
    expect(safeFileName('', 'daily')).toBe('daily')
  })

  it('removes control characters', () => {
    expect(safeFileName('a\u0000b\u001fc')).toBe('a-b-c')
  })
})

describe('validateNoteName', () => {
  it('accepts a clean name silently', () => {
    expect(validateNoteName('Reading list')).toEqual({ ok: true, value: 'Reading list' })
  })

  it('rejects an empty name', () => {
    const result = validateNoteName('   ')
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/prázdn/i)
  })

  it('accepts but explains a name that had to be changed', () => {
    const result = validateNoteName('Q1/Q2 plan')
    expect(result.ok).toBe(true)
    expect(result.value).toBe('Q1-Q2 plan')
    expect(result.message).toMatch(/nedají/i)
  })

  it('rejects a name that is too long', () => {
    const result = validateNoteName('a'.repeat(200))
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/120/)
  })

  it('rejects a name made entirely of illegal characters', () => {
    expect(validateNoteName('...').ok).toBe(false)
  })
})

describe('safeNotePath', () => {
  it('enforces the .md extension exactly once', () => {
    expect(safeNotePath('note')).toBe('note.md')
    expect(safeNotePath('note.md')).toBe('note.md')
    expect(safeNotePath('note.MD')).toBe('note.md')
  })

  it('sanitises every segment and uses POSIX separators', () => {
    expect(safeNotePath('Projects\\Q1: plan')).toBe('Projects/Q1- plan.md')
  })

  it('strips traversal and absolute prefixes', () => {
    expect(safeNotePath('../../etc/passwd')).toBe('etc/passwd.md')
    expect(safeNotePath('/absolute/note.md')).toBe('absolute/note.md')
    expect(safeNotePath('./a/./b')).toBe('a/b.md')
  })

  it('falls back for an empty path', () => {
    expect(safeNotePath('')).toBe('bez-nazvu.md')
    expect(safeNotePath('///')).toBe('bez-nazvu.md')
  })
})

describe('safeFolderPath', () => {
  it('normalises and empties out to the vault root', () => {
    expect(safeFolderPath('projects/2026')).toBe('projects/2026')
    expect(safeFolderPath('  ')).toBe('')
    expect(safeFolderPath('../escape')).toBe('escape')
    expect(safeFolderPath('a\\b')).toBe('a/b')
  })
})

describe('isPathInsideVault', () => {
  it('accepts relative paths and rejects everything else', () => {
    expect(isPathInsideVault('notes/a.md')).toBe(true)
    expect(isPathInsideVault('a.md')).toBe(true)

    expect(isPathInsideVault('')).toBe(false)
    expect(isPathInsideVault('../a.md')).toBe(false)
    expect(isPathInsideVault('a/../../b.md')).toBe(false)
    expect(isPathInsideVault('/etc/passwd')).toBe(false)
    expect(isPathInsideVault('C:/Windows/x.md')).toBe(false)
    expect(isPathInsideVault('//server/share')).toBe(false)
    expect(isPathInsideVault('..\\windows')).toBe(false)
  })
})

describe('joinNotePath / titleFromPath', () => {
  it('joins a folder and a title', () => {
    expect(joinNotePath('projects', 'Acme kickoff')).toBe('projects/Acme kickoff.md')
    expect(joinNotePath('', 'Acme')).toBe('Acme.md')
    expect(joinNotePath('a/b', 'c')).toBe('a/b/c.md')
  })

  it('recovers a title from a path', () => {
    expect(titleFromPath('daily/2026-09-15.md')).toBe('2026-09-15')
    expect(titleFromPath('note.md')).toBe('note')
    expect(titleFromPath('no-extension')).toBe('no-extension')
  })
})

describe('uniquePath', () => {
  it('returns the desired path when it is free', () => {
    expect(uniquePath('note.md', ['other.md'])).toBe('note.md')
  })

  it('appends an increasing counter before the extension', () => {
    expect(uniquePath('note.md', ['note.md'])).toBe('note 2.md')
    expect(uniquePath('note.md', ['note.md', 'note 2.md'])).toBe('note 3.md')
    expect(uniquePath('a/note.md', ['a/note.md'])).toBe('a/note 2.md')
  })

  it('compares case-insensitively, the way macOS and Windows do', () => {
    expect(uniquePath('Note.md', ['note.md'])).toBe('Note 2.md')
  })
})

describe('safeAttachmentName', () => {
  const when = new Date('2026-09-15T12:34:56.000Z')

  it('timestamps the name and keeps a known extension', () => {
    expect(safeAttachmentName('my photo.PNG', when)).toBe('20260915123456-my photo.png')
  })

  it('falls back to .bin for an unknown or missing extension', () => {
    expect(safeAttachmentName('mystery', when)).toBe('20260915123456-mystery.bin')
    expect(safeAttachmentName('x.reallylongextension', when)).toBe('20260915123456-x.bin')
  })

  it('keeps only the final path segment, so a dropped path cannot traverse', () => {
    expect(safeAttachmentName('../../evil.png', when)).toBe('20260915123456-evil.png')
    expect(safeAttachmentName('C:\\Users\\me\\cat.png', when)).toBe('20260915123456-cat.png')
  })

  it('sanitises the stem', () => {
    expect(safeAttachmentName('a:b*c.png', when)).toBe('20260915123456-a-b-c.png')
  })
})
