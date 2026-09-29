import { describe, expect, it } from 'vitest'

import {
  branchRef,
  branchUrl,
  compareSteps,
  existingTargets,
  fileChanges,
  filterBranches,
  inspectionKind,
  parseBranchReport,
  parseBranches,
  parseCompare,
  parseFolderInspection,
  parseLog,
  parseTrack,
  patchLines,
  relativeTime,
  restorable,
  switchKind,
  type Compare,
} from './branches'

/** Jeden řádek `for-each-ref` ve formátu, který posílá `git_branches`. */
function ref(
  refname: string,
  { sha = 'abc1234', date = '2026-09-20T10:00:00+02:00', author = 'Tester', upstream = '', track = '', subject = 'Commit' } = {},
): string {
  return [refname, sha, date, author, upstream, track, subject].join('\0')
}

function branchesJson(refs: string[], current = 'main', defaultBranch = 'main', fetchError = ''): string {
  return JSON.stringify({ current, default: defaultBranch, fetchError, refs: `${refs.join('\n')}\n` })
}

describe('parseTrack', () => {
  it('čte napřed, pozadu i obojí', () => {
    expect(parseTrack('')).toEqual({ ahead: 0, behind: 0, gone: false })
    expect(parseTrack('ahead 2')).toEqual({ ahead: 2, behind: 0, gone: false })
    expect(parseTrack('behind 5')).toEqual({ ahead: 0, behind: 5, gone: false })
    expect(parseTrack('ahead 1, behind 3')).toEqual({ ahead: 1, behind: 3, gone: false })
  })

  it('pozná větev smazanou na GitHubu', () => {
    expect(parseTrack('gone')).toEqual({ ahead: 0, behind: 0, gone: true })
  })
})

describe('parseBranches', () => {
  it('slije domácí a vzdálenou větev téhož jména do jedné', () => {
    const list = parseBranches(
      branchesJson([
        ref('refs/heads/main', { upstream: 'origin/main', track: 'behind 2' }),
        ref('refs/remotes/origin/HEAD'),
        ref('refs/remotes/origin/main', { sha: 'def5678', date: '2026-09-21T10:00:00+02:00', subject: 'Kolega' }),
      ]),
    )
    expect(list.branches).toHaveLength(1)
    const [main] = list.branches
    expect(main).toMatchObject({ name: 'main', local: true, remote: true, current: true, isDefault: true, behind: 2 })
    // Poslední commit je ten novější -- tady cizí, který se ještě nestáhl.
    expect(main?.subject).toBe('Kolega')
    expect(main?.sha).toBe('def5678')
  })

  it('origin/HEAD není větev', () => {
    const list = parseBranches(branchesJson([ref('refs/remotes/origin/HEAD'), ref('refs/remotes/origin/main')]))
    expect(list.branches.map((branch) => branch.name)).toEqual(['main'])
  })

  it('řadí aktuální, výchozí, pak podle posledního commitu', () => {
    const list = parseBranches(
      branchesJson(
        [
          ref('refs/remotes/origin/main', { date: '2026-09-01T10:00:00Z' }),
          ref('refs/remotes/origin/stara', { date: '2026-08-01T10:00:00Z' }),
          ref('refs/remotes/origin/nova', { date: '2026-09-25T10:00:00Z' }),
          ref('refs/heads/docs/moje', { date: '2026-07-01T10:00:00Z' }),
        ],
        'docs/moje',
      ),
    )
    expect(list.branches.map((branch) => branch.name)).toEqual(['docs/moje', 'main', 'nova', 'stara'])
    expect(list.branches[0]).toMatchObject({ current: true, local: true, remote: false })
    expect(list.branches[2]).toMatchObject({ local: false, remote: true })
  })

  it('předmět commitu může obsahovat cokoli, i dvojtečky a lomítka', () => {
    const list = parseBranches(branchesJson([ref('refs/heads/main', { subject: 'Oprava: a/b — „uvozovky“' })]))
    expect(list.branches[0]?.subject).toBe('Oprava: a/b — „uvozovky“')
  })

  it('předá chybu fetche a nesmyslný vstup nespadne', () => {
    expect(parseBranches(branchesJson([], 'main', 'main', 'could not resolve host')).fetchError).toBe(
      'could not resolve host',
    )
    expect(parseBranches('není json').branches).toEqual([])
  })

  it('snese konce řádků z Windows', () => {
    const json = JSON.stringify({ current: 'main', default: 'main', fetchError: '', refs: `${ref('refs/heads/main')}\r\n` })
    expect(parseBranches(json).branches[0]?.subject).toBe('Commit')
  })
})

describe('výběr a přepnutí', () => {
  const list = parseBranches(
    branchesJson(
      [
        ref('refs/heads/main', { upstream: 'origin/main', track: 'behind 1' }),
        ref('refs/remotes/origin/main'),
        ref('refs/heads/docs/lokal'),
        ref('refs/heads/smazana', { upstream: 'origin/smazana', track: 'gone' }),
        ref('refs/remotes/origin/feature/navod', { author: 'Kolegyně', subject: 'Nový návod' }),
      ],
      'main',
    ),
  )
  const named = (name: string) => list.branches.find((branch) => branch.name === name)!

  it('dívá se na GitHub, když tam větev je', () => {
    expect(branchRef(named('feature/navod'))).toBe('origin/feature/navod')
    expect(branchRef(named('docs/lokal'))).toBe('docs/lokal')
  })

  it('ví, co tlačítko udělá', () => {
    expect(switchKind(named('main'))).toBe('pull')
    expect(switchKind(named('docs/lokal'))).toBe('switch')
    expect(switchKind(named('feature/navod'))).toBe('download')
    expect(switchKind({ ...named('main'), behind: 0 })).toBe('current')
  })

  it('hledá ve jméně, autorovi i commitu, bez diakritiky', () => {
    expect(filterBranches(list.branches, 'kolegyne').map((branch) => branch.name)).toEqual(['feature/navod'])
    expect(filterBranches(list.branches, 'NAVOD').map((branch) => branch.name)).toEqual(['feature/navod'])
    expect(filterBranches(list.branches, '')).toHaveLength(list.branches.length)
  })

  it('na existující se odesílá jen tam, kde to dává smysl', () => {
    // Výchozí má v dialogu vlastní volbu, smazaná na GitHubu nikam nevede,
    // jen domácí (a ne ta, na které se stojí) na GitHubu není.
    expect(existingTargets(list).map((branch) => branch.name)).toEqual(['feature/navod'])
  })

  it('výchozí větev se z „existující“ vyřadí i tehdy, když ji klon nezná', () => {
    // Bez `origin/HEAD` nemá žádná větev příznak výchozí -- main by se jinak
    // dala vybrat bez varování, které má vlastní volba.
    const unknown = parseBranches(
      branchesJson([ref('refs/heads/main'), ref('refs/remotes/origin/main'), ref('refs/remotes/origin/docs/x')], 'main', ''),
    )
    expect(unknown.branches.some((branch) => branch.isDefault)).toBe(false)
    expect(existingTargets(unknown, 'main').map((branch) => branch.name)).toEqual(['docs/x'])
  })

  it('adresa větve na GitHubu', () => {
    expect(branchUrl({ host: 'github.com', owner: 'o', repo: 'r' }, 'docs/2026 a')).toBe(
      'https://github.com/o/r/tree/docs/2026%20a',
    )
  })
})

describe('co větev přinesla', () => {
  it('commity z `log` s nulami', () => {
    expect(parseLog(`${['abc1234', 'Tester', '2026-09-20T10:00:00Z', 'Oprava: návod'].join('\0')}\n`)).toEqual([
      { sha: 'abc1234', author: 'Tester', date: '2026-09-20T10:00:00Z', subject: 'Oprava: návod' },
    ])
  })

  it('soubory: druh změny, počty řádků, jen Markdown jménem', () => {
    const { files, others } = fileChanges(
      'M\0docs/a.md\0A\0docs/nový.md\0D\0docs/b.md\0M\0src/app.ts\0',
      '3\t1\tdocs/a.md\0' + '5\t0\tdocs/nový.md\0' + '0\t7\tdocs/b.md\0' + '1\t1\tsrc/app.ts\0',
    )
    expect(files).toEqual([
      { path: 'docs/a.md', kind: 'modified', additions: 3, deletions: 1 },
      { path: 'docs/b.md', kind: 'deleted', additions: 0, deletions: 7 },
      { path: 'docs/nový.md', kind: 'added', additions: 5, deletions: 0 },
    ])
    expect(others).toBe(1)
  })

  it('binární soubor nemá počty řádků', () => {
    const { files } = fileChanges('M\0obr.md\0', '-\t-\tobr.md\0')
    expect(files[0]).toMatchObject({ additions: null, deletions: null })
  })

  it('soubory, které git nesleduje, jsou „jen tady“', () => {
    const { files } = fileChanges('', '', 'docs/c.md\0poznámky.txt\0')
    expect(files).toEqual([{ path: 'docs/c.md', kind: 'local', additions: null, deletions: null }])
  })

  it('přečte celou odpověď `git_branch_log`', () => {
    const report = parseBranchReport(
      JSON.stringify({
        ahead: 2,
        behind: 1,
        log: 'a1\0T\0d\0První\nb2\0T\0d\0Druhý\n',
        nameStatus: 'A\0docs/n.md\0',
        numstat: '4\t0\tdocs/n.md\0',
      }),
    )
    expect(report.ahead).toBe(2)
    expect(report.behind).toBe(1)
    expect(report.commits.map((commit) => commit.subject)).toEqual(['První', 'Druhý'])
    expect(report.files).toEqual([{ path: 'docs/n.md', kind: 'added', additions: 4, deletions: 0 }])
  })
})

describe('porovnání s výchozí větví', () => {
  const compare = (patch: Partial<Compare> = {}): Compare => ({
    base: 'origin/main',
    branch: 'main',
    ahead: 0,
    behind: 0,
    files: [],
    others: 0,
    fetchError: '',
    ...patch,
  })

  it('přečte odpověď `git_compare` i se soubory mimo git', () => {
    const parsed = parseCompare(
      JSON.stringify({
        base: 'origin/main',
        branch: 'main',
        ahead: 0,
        behind: 3,
        nameStatus: 'M\0guide.md\0D\0README.md\0',
        numstat: '2\t1\tguide.md\0' + '0\t4\tREADME.md\0',
        untracked: 'novy.md\0',
        fetchError: '',
      }),
    )
    expect(parsed?.behind).toBe(3)
    expect(parsed?.files.map((file) => [file.path, file.kind])).toEqual([
      ['guide.md', 'modified'],
      ['novy.md', 'local'],
      ['README.md', 'deleted'],
    ])
    expect(parseCompare('nesmysl')).toBeNull()
  })

  it('shoda = není co dělat', () => {
    expect(compareSteps(compare(), 0, 'main')).toEqual(['identical'])
  })

  it('rozdělané změny na main se dají odeslat i vrátit', () => {
    const steps = compareSteps(
      compare({ files: [{ path: 'a.md', kind: 'modified', additions: 1, deletions: 1 }] }),
      1,
      'main',
    )
    expect(steps).toEqual(['publish', 'restore'])
  })

  it('pozadu za main se nevrací, napřed se stahuje', () => {
    // V seznamu jsou i soubory, které změnil jen GitHub; „vrátit“ by z nich
    // udělalo napůl stažené změny.
    const steps = compareSteps(
      compare({ behind: 2, files: [{ path: 'a.md', kind: 'modified', additions: 1, deletions: 1 }] }),
      1,
      'main',
    )
    expect(steps).toEqual(['publish', 'pull'])
  })

  it('na jiné větvi se nevrací: vracelo by to potichu práci té větve', () => {
    const steps = compareSteps(
      compare({ branch: 'docs/x', ahead: 2, files: [{ path: 'a.md', kind: 'modified', additions: 1, deletions: 0 }] }),
      0,
      'main',
    )
    expect(steps).toEqual(['ahead'])
  })

  it('vrátit jde jen to, co v main je -- nové soubory ne', () => {
    const files = [
      { path: 'a.md', kind: 'modified' as const, additions: 1, deletions: 0 },
      { path: 'b.md', kind: 'deleted' as const, additions: 0, deletions: 1 },
      { path: 'c.md', kind: 'local' as const, additions: null, deletions: null },
      { path: 'd.md', kind: 'added' as const, additions: 2, deletions: 0 },
    ]
    expect(restorable(compare({ files })).map((file) => file.path)).toEqual(['a.md', 'b.md'])
    // Jen nové soubory: odeslat ano, vrátit ne.
    expect(compareSteps(compare({ files: files.slice(2) }), 2, 'main')).toEqual(['publish'])
  })
})

describe('napojení složky', () => {
  const inspection = (patch: object = {}) =>
    parseFolderInspection(JSON.stringify({ root: '', remote: '', isRoot: false, markdownFiles: 4, ...patch }))!

  it('obyčejná složka se dá napojit', () => {
    expect(inspectionKind(inspection(), 'https://github.com/o/r.git')).toBe('plain')
    expect(inspection().markdownFiles).toBe(4)
  })

  it('kopie téhož repozitáře se pozná podle remote, v jakémkoli tvaru', () => {
    const same = inspection({ root: '/x', remote: 'git@github.com:O/R.git', isRoot: true })
    expect(inspectionKind(same, 'https://github.com/o/r.git')).toBe('same')
    // I podsložka téhož repa: je to pořád on.
    expect(inspectionKind({ ...same, isRoot: false }, 'https://github.com/o/r.git')).toBe('same')
  })

  it('cizí repozitář a složka uvnitř cizího se odmítnou', () => {
    expect(
      inspectionKind(inspection({ root: '/x', remote: 'https://github.com/jiny/repo.git', isRoot: true }), 'https://github.com/o/r.git'),
    ).toBe('other')
    expect(
      inspectionKind(inspection({ root: '/x', remote: 'https://github.com/jiny/repo.git' }), 'https://github.com/o/r.git'),
    ).toBe('inside')
    // Repo bez remote je taky „jiné“ -- nevíme, čí je.
    expect(inspectionKind(inspection({ root: '/x', isRoot: true }), 'https://github.com/o/r.git')).toBe('other')
  })
})

describe('patchLines', () => {
  it('rozliší hlavičku, úseky, přidané, smazané a kontext', () => {
    const lines = patchLines(
      [
        'diff --git a/a.md b/a.md',
        'index 1..2 100644',
        '--- a/a.md',
        '+++ b/a.md',
        '@@ -1,2 +1,2 @@',
        ' # Nadpis',
        '-stará',
        '+nová',
        '\\ No newline at end of file',
        '',
      ].join('\r\n'),
    )
    expect(lines.map((line) => line.kind)).toEqual(['meta', 'meta', 'meta', 'meta', 'hunk', 'context', 'del', 'add', 'note'])
  })

  it('řádek s `---` v textu je smazaný řádek, ne hlavička', () => {
    const lines = patchLines('@@ -1 +1 @@\n---- oddělovač\n+++ nadpis\n')
    expect(lines.map((line) => line.kind)).toEqual(['hunk', 'del', 'add'])
  })
})

describe('relativeTime', () => {
  const now = Date.parse('2026-09-29T12:00:00Z')

  it('nedávno lidsky, starší datem', () => {
    expect(relativeTime('2026-09-29T11:59:40Z', now)).toBe('právě teď')
    expect(relativeTime('2026-09-29T11:15:00Z', now)).toBe('před 45 min')
    expect(relativeTime('2026-09-29T07:00:00Z', now)).toBe('před 5 h')
    expect(relativeTime('2026-09-26T12:00:00Z', now)).toBe('před 3 dny')
    expect(relativeTime('2026-06-01T12:00:00Z', now)).toBe('1. 6. 2026')
    expect(relativeTime('nesmysl', now)).toBe('')
  })
})
