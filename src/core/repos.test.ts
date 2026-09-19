import { describe, expect, it } from 'vitest'

import {
  cloneFolderName,
  cloneProgress,
  filterRepos,
  formatRepoSize,
  matchClones,
  parseClones,
  parseRepos,
  sortRepos,
  type Repo,
} from './repos'

/** Přesně to, co vrací `gh api user/repos` -- včetně nullů. */
const API = JSON.stringify([
  {
    full_name: 'myspulin24/pilcrow',
    description: 'Pilcrow — čtečka Markdownu',
    language: 'TypeScript',
    size: 1667,
    default_branch: 'main',
    updated_at: '2026-09-19T12:19:38Z',
    clone_url: 'https://github.com/myspulin24/pilcrow.git',
    private: false,
    fork: false,
    archived: false,
    permissions: { admin: true, push: true, pull: true },
  },
  {
    full_name: 'myspulin24/Personal-Monthly-Budget',
    description: null,
    language: null,
    size: 620,
    default_branch: 'main',
    updated_at: '2026-09-15T19:37:50Z',
    clone_url: 'https://github.com/myspulin24/Personal-Monthly-Budget.git',
    private: true,
    fork: false,
    archived: false,
    permissions: { admin: true, push: true, pull: true },
  },
  {
    full_name: 'cizi-org/dokumentace',
    description: 'Jen ke čtení',
    language: 'Markdown',
    size: 40,
    default_branch: 'trunk',
    updated_at: '2026-08-01T10:00:00Z',
    clone_url: 'https://github.com/cizi-org/dokumentace.git',
    private: false,
    fork: true,
    archived: false,
    permissions: { admin: false, push: false, pull: true },
  },
])

const repo = (patch: Partial<Repo> = {}): Repo => ({
  fullName: 'o/r',
  owner: 'o',
  name: 'r',
  description: '',
  language: '',
  sizeKb: 0,
  defaultBranch: 'main',
  updatedAt: '2026-01-01T00:00:00Z',
  cloneUrl: 'https://github.com/o/r.git',
  private: false,
  fork: false,
  archived: false,
  canPush: true,
  ...patch,
})

describe('parseRepos', () => {
  it('čte tvar REST, ne tvar z gh repo list', () => {
    const repos = parseRepos(API)
    expect(repos).toHaveLength(3)
    expect(repos[0]).toEqual({
      fullName: 'myspulin24/pilcrow',
      owner: 'myspulin24',
      name: 'pilcrow',
      description: 'Pilcrow — čtečka Markdownu',
      language: 'TypeScript',
      sizeKb: 1667,
      defaultBranch: 'main',
      updatedAt: '2026-09-19T12:19:38Z',
      cloneUrl: 'https://github.com/myspulin24/pilcrow.git',
      private: false,
      fork: false,
      archived: false,
      canPush: true,
    })
  })

  it('null v popisu a jazyce je prázdný řetězec, ne pád', () => {
    const budget = parseRepos(API)[1]
    expect(budget?.description).toBe('')
    expect(budget?.language).toBe('')
    expect(budget?.private).toBe(true)
  })

  it('pozná repo bez práva zápisu -- push by v něm selhal', () => {
    const repos = parseRepos(API)
    expect(repos[0]?.canPush).toBe(true)
    expect(repos[2]?.canPush).toBe(false)
    expect(repos[2]?.fork).toBe(true)
  })

  it('smetí a chybějící jméno se přeskočí', () => {
    expect(parseRepos('')).toEqual([])
    expect(parseRepos('{}')).toEqual([])
    expect(parseRepos('[1,"x",null]')).toEqual([])
    expect(parseRepos('[{"full_name":"bez-lomitka"}]')).toEqual([])
  })
})

describe('matchClones', () => {
  it('páruje podle remote, ne podle jména složky', () => {
    // Přesně situace z disku: složka `things-3` je repo `Notes_MJ`.
    const repos = [repo({ fullName: 'm/Notes_MJ', name: 'Notes_MJ', cloneUrl: 'https://github.com/m/Notes_MJ.git' })]
    const clones = parseClones(
      JSON.stringify([{ path: 'C:/Users/micha/dev/things-3', remote: 'https://github.com/m/Notes_MJ.git' }]),
    )
    expect(matchClones(repos, clones)[0]?.localPath).toBe('C:/Users/micha/dev/things-3')
  })

  it('nesejde na tvaru adresy ani na velikosti písmen', () => {
    const repos = [repo({ cloneUrl: 'https://github.com/O/R.git' })]
    for (const remote of [
      'git@github.com:o/r.git',
      'ssh://git@github.com/o/r',
      'https://github.com/o/r',
    ]) {
      expect(matchClones(repos, [{ path: '/tmp/x', remote }])[0]?.localPath, remote).toBe('/tmp/x')
    }
  })

  it('cizí ani prázdný remote nespáruje', () => {
    const repos = [repo()]
    expect(matchClones(repos, [{ path: '/tmp/x', remote: 'https://github.com/jiny/repo.git' }])[0]?.localPath).toBeUndefined()
    expect(matchClones(repos, [{ path: '/tmp/x', remote: '' }])[0]?.localPath).toBeUndefined()
    expect(matchClones(repos, [])[0]?.localPath).toBeUndefined()
  })

  it('při dvou kopiích vyhraje ta první podle abecedy, ne podle pořadí na vstupu', () => {
    const repos = [repo()]
    const clones = [
      { path: '/b/kopie', remote: 'https://github.com/o/r.git' },
      { path: '/a/original', remote: 'https://github.com/o/r.git' },
    ]
    expect(matchClones(repos, clones)[0]?.localPath).toBe('/a/original')
    expect(matchClones(repos, [...clones].reverse())[0]?.localPath).toBe('/a/original')
  })
})

describe('parseClones', () => {
  it('čte seznam z Rustu a zahodí položky bez cesty', () => {
    expect(parseClones('[{"path":"/a","remote":"u"},{"remote":"bez cesty"},"x"]')).toEqual([
      { path: '/a', remote: 'u' },
    ])
    expect(parseClones('nesmysl')).toEqual([])
  })
})

describe('hledání a řazení', () => {
  const repos = [
    repo({ fullName: 'm/pilcrow', description: 'Čtečka Markdownu', language: 'TypeScript', updatedAt: '2026-09-19T00:00:00Z' }),
    repo({ fullName: 'm/rozpocet', description: 'Osobní rozpočet', language: 'Python', updatedAt: '2026-09-15T00:00:00Z' }),
    repo({ fullName: 'org/docs', description: '', language: 'Markdown', updatedAt: '2026-09-01T00:00:00Z' }),
  ]

  it('hledá ve jméně, popisu i jazyce a nezajímá ho diakritika', () => {
    expect(filterRepos(repos, 'pilcrow').map((r) => r.fullName)).toEqual(['m/pilcrow'])
    expect(filterRepos(repos, 'CTECKA').map((r) => r.fullName)).toEqual(['m/pilcrow'])
    expect(filterRepos(repos, 'osobni').map((r) => r.fullName)).toEqual(['m/rozpocet'])
    expect(filterRepos(repos, 'python').map((r) => r.fullName)).toEqual(['m/rozpocet'])
    expect(filterRepos(repos, 'org/').map((r) => r.fullName)).toEqual(['org/docs'])
    expect(filterRepos(repos, '  ')).toHaveLength(3)
    expect(filterRepos(repos, 'nic')).toEqual([])
  })

  it('naklonované nahoru, zbytek od nejnovějšího', () => {
    const withLocal = [repos[0]!, { ...repos[2]!, localPath: '/a' }, repos[1]!]
    expect(sortRepos(withLocal).map((r) => r.fullName)).toEqual(['org/docs', 'm/pilcrow', 'm/rozpocet'])
  })
})

describe('popisky', () => {
  it('velikost je lidská a v kilobajtech na vstupu', () => {
    expect(formatRepoSize(0)).toBe('')
    expect(formatRepoSize(-5)).toBe('')
    expect(formatRepoSize(620)).toBe('620 kB')
    expect(formatRepoSize(1667)).toBe('1,6 MB')
    expect(formatRepoSize(204800)).toBe('200 MB')
  })

  it('jméno složky snese, co by souborový systém nevzal', () => {
    expect(cloneFolderName(repo({ name: 'docs' }))).toBe('docs')
    expect(cloneFolderName(repo({ name: 'a/b:c*d?' }))).toBe('a-b-c-d-')
    expect(cloneFolderName(repo({ name: '...' }))).toBe('repozitar')
  })
})

describe('cloneProgress', () => {
  it('bere poslední úsek za návratem vozíku, ne celý řádek', () => {
    // Přesně to, co git píše: jeden řádek, desítky `\r`.
    const transcript =
      "Cloning into 'x'...\nReceiving objects:   0% (1/683)\rReceiving objects:  50% (342/683)\rReceiving objects: 100% (683/683), 832.29 KiB | 2.48 MiB/s, done.\r"
    expect(cloneProgress(transcript)).toEqual({ phase: 'receiving', percent: 100 })
  })

  it('pozná jednotlivé fáze', () => {
    expect(cloneProgress("Cloning into 'x'...")).toEqual({ phase: 'start', percent: null })
    expect(cloneProgress('remote: Counting objects:  18% (2/11)')).toEqual({ phase: 'counting', percent: 18 })
    expect(cloneProgress('remote: Compressing objects:  45% (5/11)')).toEqual({ phase: 'compressing', percent: 45 })
    expect(cloneProgress('Resolving deltas:  99% (358/361)')).toEqual({ phase: 'resolving', percent: 99 })
    expect(cloneProgress('Updating files:  80% (100/125)')).toEqual({ phase: 'files', percent: 80 })
  })

  it('prázdný vstup nic nehlásí a nesmyslné procento se ořízne', () => {
    expect(cloneProgress('')).toBeNull()
    expect(cloneProgress('\r\n  \r')).toBeNull()
    expect(cloneProgress('Receiving objects: 999% (1/1)')).toEqual({ phase: 'receiving', percent: 100 })
  })
})
