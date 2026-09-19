import { describe, expect, it } from 'vitest'

import {
  compareVersions,
  downloadPercent,
  formatBytes,
  formatProgress,
  formatReleaseDate,
  isNewer,
  parseVersion,
  summariseNotes,
} from './version'

describe('parseVersion', () => {
  it('reads a plain semver, with or without the v prefix', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] })
    expect(parseVersion('v0.1.0')).toEqual({ major: 0, minor: 1, patch: 0, prerelease: [] })
    expect(parseVersion('  2.0.0  ')?.major).toBe(2)
  })

  it('splits a prerelease into numeric and text parts', () => {
    expect(parseVersion('1.0.0-beta.2')?.prerelease).toEqual(['beta', 2])
  })

  it('ignores build metadata', () => {
    expect(parseVersion('1.0.0+20260916')?.prerelease).toEqual([])
  })

  it('returns null for anything that is not a version', () => {
    for (const bad of ['', 'latest', '1.2', '1.2.3.4', 'v', 'nightly-2026']) {
      expect(parseVersion(bad)).toBeNull()
    }
  })
})

describe('compareVersions', () => {
  it('orders by major, then minor, then patch', () => {
    expect(compareVersions('1.0.0', '2.0.0')).toBe(-1)
    expect(compareVersions('1.3.0', '1.2.9')).toBe(1)
    expect(compareVersions('0.1.10', '0.1.9')).toBe(1)
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
  })

  it('puts a prerelease below the release it leads to', () => {
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBe(-1)
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBe(1)
  })

  it('orders prereleases among themselves', () => {
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBe(-1)
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.10')).toBe(-1)
    expect(compareVersions('1.0.0-alpha.1', '1.0.0-alpha.beta')).toBe(-1)
  })

  it('treats an unreadable version as the older one', () => {
    expect(compareVersions('nonsense', '1.0.0')).toBe(-1)
    expect(compareVersions('1.0.0', 'nonsense')).toBe(1)
    expect(compareVersions('nonsense', 'also nonsense')).toBe(0)
  })
})

describe('isNewer', () => {
  it('accepts only a strictly higher version', () => {
    expect(isNewer('0.2.0', '0.1.0')).toBe(true)
    expect(isNewer('0.1.0', '0.1.0')).toBe(false)
    expect(isNewer('0.0.9', '0.1.0')).toBe(false)
  })

  it('refuses a version it cannot parse, however the server spells it', () => {
    // The whole point: a broken or hostile latest.json cannot talk the app
    // into installing something.
    expect(isNewer('', '0.1.0')).toBe(false)
    expect(isNewer('9999', '0.1.0')).toBe(false)
    expect(isNewer('../../etc/passwd', '0.1.0')).toBe(false)
  })
})

describe('downloadPercent', () => {
  it('reports whole percent', () => {
    expect(downloadPercent(0, 100)).toBe(0)
    expect(downloadPercent(50, 100)).toBe(50)
    expect(downloadPercent(100, 100)).toBe(100)
    expect(downloadPercent(1, 3)).toBe(33)
  })

  it('returns null when the total is unknown, so the bar can go indeterminate', () => {
    expect(downloadPercent(1024, null)).toBeNull()
    expect(downloadPercent(1024, 0)).toBeNull()
  })

  it('never leaves 0..100 even if the server lies about the size', () => {
    expect(downloadPercent(500, 100)).toBe(100)
    expect(downloadPercent(-5, 100)).toBe(0)
  })
})

describe('formatBytes / formatProgress', () => {
  it('scales the unit and uses a Czech decimal comma', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1,5 kB')
    expect(formatBytes(4_781_568)).toBe('4,6 MB')
  })

  it('survives nonsense input', () => {
    expect(formatBytes(-1)).toBe('0 B')
    expect(formatBytes(Number.NaN)).toBe('0 B')
  })

  it('shows both numbers when the total is known', () => {
    expect(formatProgress(1_048_576, 4_194_304)).toBe('1,0 MB z 4,0 MB')
    expect(formatProgress(1_048_576, null)).toBe('1,0 MB')
  })
})

describe('summariseNotes', () => {
  it('trims blank edges and collapses repeated blank lines', () => {
    expect(summariseNotes('\n\nPrvní\n\n\nDruhá\n\n')).toBe('První\n\nDruhá')
  })

  it('drops the GitHub changelog footer', () => {
    const notes = 'Opraveno hledání\n\n**Full Changelog**: https://github.com/a/b/compare/v1...v2'
    expect(summariseNotes(notes)).toBe('Opraveno hledání')
  })

  it('cuts a long list and says how much is left, declined correctly', () => {
    const notes = Array.from({ length: 15 }, (_, i) => `- řádek ${i + 1}`).join('\n')
    const short = summariseNotes(notes, 12)
    expect(short).toContain('- řádek 12')
    expect(short).not.toContain('- řádek 13')
    expect(short).toContain('… a 3 další řádky')
  })

  it('leaves a short note alone', () => {
    expect(summariseNotes('- jedna\n- dva')).toBe('- jedna\n- dva')
  })
})

describe('formatReleaseDate', () => {
  it('z ISO udělá české datum a čas v místním pásmu', () => {
    // Testy běží v UTC (viz vitest.config.ts), takže výsledek je předvídatelný.
    expect(formatReleaseDate('2026-09-19T07:45:16.633Z')).toBe('19. 9. 2026 v 7:45')
  })

  it('nepřidává nuly tam, kam v češtině nepatří', () => {
    // Den, měsíc ani hodina se nedoplňují nulou; minuty ano.
    expect(formatReleaseDate('2026-01-05T09:07:00.000Z')).toBe('5. 1. 2026 v 9:07')
  })

  it('půlnoc je 0:00, ne 24:00 ani prázdno', () => {
    expect(formatReleaseDate('2026-03-01T00:00:00.000Z')).toBe('1. 3. 2026 v 0:00')
  })

  it('nečitelné datum vrátí prázdno, ne „Invalid Date“', () => {
    for (const bad of ['', '   ', 'včera', '2026-13-45T99:99:99Z']) {
      expect(formatReleaseDate(bad), bad).toBe('')
    }
  })
})
