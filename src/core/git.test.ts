import { describe, expect, it } from 'vitest'

import {
  actionsUrl,
  activeWorkflows,
  compareUrl,
  currentPublishStep,
  defaultMergeMethod,
  findDeviceCode,
  ghStep,
  gitStep,
  isCommittable,
  isGitHub,
  isValidBranchName,
  mergeBlocker,
  outcome,
  overallOutcome,
  parseGhAuth,
  parseGitStatus,
  parseJobs,
  parseMergeMethods,
  parsePullRequest,
  parseRemote,
  parseRuns,
  parseWorkflows,
  runsSettled,
  isPrUrl,
  suggestBranch,
  suggestPrBody,
  suggestPrTitle,
  suggestMessage,
  toRepoRelative,
  type GitProbe,
} from './git'

const probe = (patch: Partial<GitProbe> = {}): GitProbe => ({
  gitInstalled: true,
  gitVersion: 'git version 2.50.0',
  gitPath: 'git',
  ghInstalled: true,
  ghVersion: 'gh version 2.92.0',
  ghPath: 'gh',
  ghAuth: JSON.stringify({
    hosts: {
      'github.com': [{ state: 'success', active: true, host: 'github.com', login: 'myspulin24', scopes: 'gist, read:org, repo, workflow' }],
    },
  }),
  repoRoot: 'C:/Users/micha/dev/pilcrow',
  branch: 'main',
  defaultBranch: 'main',
  headSha: '9b4ab0e7fba8fcc617c64f47f0a5ae5ab0bbb5ee',
  remoteUrl: 'https://github.com/myspulin24/pilcrow.git',
  userName: 'Jasek-Michal',
  userEmail: 'michal@example.com',
  gitInstallCommand: 'winget install Git.Git',
  ghInstallCommand: 'winget install GitHub.cli',
  error: '',
  ...patch,
})

describe('parseGhAuth', () => {
  it('přečte aktivní účet, jak ho vypisuje gh 2.92', () => {
    const account = parseGhAuth(probe().ghAuth)
    expect(account).toEqual({
      loggedIn: true,
      login: 'myspulin24',
      host: 'github.com',
      scopes: ['gist', 'read:org', 'repo', 'workflow'],
    })
  })

  it('prázdné hosts znamená nikdo, ne chyba', () => {
    expect(parseGhAuth('{"hosts":{}}')).toEqual({ loggedIn: false, login: '', host: '', scopes: [] })
  })

  it('rozbitý nebo cizí vstup je null, ne pád', () => {
    expect(parseGhAuth('')).toBeNull()
    expect(parseGhAuth('nic')).toBeNull()
    expect(parseGhAuth('[1,2]')).toBeNull()
    expect(parseGhAuth('{"hosts":[]}')).toBeNull()
  })

  it('účet s chybou tokenu není přihlášený', () => {
    const raw = JSON.stringify({ hosts: { 'github.com': [{ state: 'error', active: true, login: 'x' }] } })
    expect(parseGhAuth(raw)?.loggedIn).toBe(false)
  })
})

describe('parseRemote', () => {
  it('rozebere https, ssh:// i scp tvar', () => {
    const expected = { host: 'github.com', owner: 'myspulin24', repo: 'pilcrow' }
    expect(parseRemote('https://github.com/myspulin24/pilcrow.git')).toEqual(expected)
    expect(parseRemote('https://github.com/myspulin24/pilcrow')).toEqual(expected)
    expect(parseRemote('ssh://git@github.com/myspulin24/pilcrow.git')).toEqual(expected)
    expect(parseRemote('git@github.com:myspulin24/pilcrow.git')).toEqual(expected)
    expect(parseRemote('https://user@GitHub.com/myspulin24/pilcrow.git/')).toEqual(expected)
  })

  it('cizí hostitel není GitHub', () => {
    const remote = parseRemote('git@gitlab.com:team/docs.git')
    expect(remote).toEqual({ host: 'gitlab.com', owner: 'team', repo: 'docs' })
    expect(isGitHub(remote)).toBe(false)
    expect(isGitHub(parseRemote('https://github.com/a/b'))).toBe(true)
  })

  it('bez vlastníka nebo prázdné je null', () => {
    expect(parseRemote('')).toBeNull()
    expect(parseRemote('https://github.com/jen-jedno')).toBeNull()
    expect(parseRemote('nesmysl')).toBeNull()
  })
})

describe('adresy', () => {
  const remote = { host: 'github.com', owner: 'myspulin24', repo: 'pilcrow' }

  it('compare nechává lomítka ve jménu větve, jinak by GitHub stránku nenašel', () => {
    expect(compareUrl(remote, 'main', 'docs/2026-09-19-1030')).toBe(
      'https://github.com/myspulin24/pilcrow/compare/main...docs/2026-09-19-1030?expand=1',
    )
  })

  it('zvláštní znaky se ale zakódují', () => {
    expect(compareUrl(remote, 'main', 'čeština i mezera')).toContain('%C4%8De%C5%A1tina%20i%20mezera')
  })

  it('actions vede na přehled běhů', () => {
    expect(actionsUrl(remote)).toBe('https://github.com/myspulin24/pilcrow/actions')
  })
})

describe('kroky', () => {
  it('git: jeden krok napřed, v pořadí', () => {
    expect(gitStep(null, false)).toBe('unsupported')
    expect(gitStep(null, true)).toBe('install-git')
    expect(gitStep(probe({ gitInstalled: false }), true)).toBe('install-git')
    expect(gitStep(probe({ repoRoot: '' }), true)).toBe('not-repo')
    expect(gitStep(probe({ remoteUrl: '' }), true)).toBe('no-remote')
    expect(gitStep(probe({ userEmail: '' }), true)).toBe('identity')
    expect(gitStep(probe({ userName: '  ' }), true)).toBe('identity')
    expect(gitStep(probe(), true)).toBe('ready')
  })

  it('gh: mimo GitHub se neřeší, jinak instalace → přihlášení → hotovo', () => {
    const github = parseRemote('https://github.com/a/b')
    expect(ghStep(probe(), parseRemote('git@gitlab.com:a/b.git'))).toBe('not-github')
    expect(ghStep(probe({ ghInstalled: false }), github)).toBe('install')
    expect(ghStep(probe({ ghAuth: '{"hosts":{}}' }), github)).toBe('login')
    expect(ghStep(probe(), github)).toBe('ready')
  })
})

describe('parseGitStatus', () => {
  const nul = (...entries: string[]) => `${entries.join('\0')}\0`

  it('čte -z: mezera ve jméně bez uvozovek, přejmenování jako dvě položky', () => {
    const raw = nul(' M docs/tracked.md', '?? docs/a b.md', 'R  docs/new.md', 'docs/old.md', ' M src/main.rs')
    expect(parseGitStatus(raw)).toEqual([
      { path: 'docs/a b.md', kind: 'untracked' },
      { path: 'docs/new.md', kind: 'renamed', from: 'docs/old.md' },
      { path: 'docs/tracked.md', kind: 'modified' },
    ])
  })

  it('pozná smazání, přidání a konflikt', () => {
    const raw = nul('D  a.md', 'A  b.md', 'UU c.md', 'AA d.md')
    const kinds = Object.fromEntries(parseGitStatus(raw).map((file) => [file.path, file.kind]))
    expect(kinds).toEqual({ 'a.md': 'deleted', 'b.md': 'added', 'c.md': 'conflicted', 'd.md': 'conflicted' })
    expect(isCommittable({ path: 'c.md', kind: 'conflicted' })).toBe(false)
    expect(isCommittable({ path: 'a.md', kind: 'deleted' })).toBe(true)
  })

  it('omezí se na otevřenou složku a ignorované soubory přeskočí', () => {
    const raw = nul(' M docs/a.md', ' M README.md', '!! docs/build.md', ' M docs/sub/b.md')
    expect(parseGitStatus(raw, 'docs').map((file) => file.path)).toEqual(['docs/a.md', 'docs/sub/b.md'])
    expect(parseGitStatus(raw, '').map((file) => file.path)).toEqual(['docs/a.md', 'docs/sub/b.md', 'README.md'])
    // `docsx` není pod `docs`.
    expect(parseGitStatus(nul(' M docsx/a.md'), 'docs')).toEqual([])
  })

  it('prázdný výstup a smetí nevadí', () => {
    expect(parseGitStatus('')).toEqual([])
    expect(parseGitStatus('x')).toEqual([])
    expect(parseGitStatus(nul('?? obrázek.png'))).toEqual([])
  })
})

describe('toRepoRelative', () => {
  it('umí obě lomítka a na Windows nehledí na velikost písmen', () => {
    expect(toRepoRelative('C:\\Users\\micha\\dev\\pilcrow', 'c:/users/micha/dev/pilcrow/docs/a.md')).toBe('docs/a.md')
    expect(toRepoRelative('C:/repo', 'C:/repo')).toBe('')
    expect(toRepoRelative('/home/m/repo', '/home/m/repo/docs')).toBe('docs')
  })

  it('cesta mimo repo je null -- i když sdílí předponu', () => {
    expect(toRepoRelative('/home/m/repo', '/home/m/repository/x.md')).toBeNull()
    expect(toRepoRelative('/home/m/Repo', '/home/m/repo/x.md')).toBeNull()
    expect(toRepoRelative('', '/x')).toBeNull()
  })
})

describe('návrhy', () => {
  it('větev nese datum a čas s nulami', () => {
    expect(suggestBranch(new Date(2026, 8, 19, 9, 5))).toBe('docs/2026-09-19-0905')
  })

  it('zpráva vyjmenuje soubory, ale ne donekonečna', () => {
    const file = (path: string) => ({ path, kind: 'modified' as const })
    expect(suggestMessage([])).toBe('')
    expect(suggestMessage([file('docs/README.md')])).toBe('Dokumentace: README.md')
    expect(suggestMessage([file('a.md'), file('b.md'), file('c.md')])).toBe('Dokumentace: a.md, b.md, c.md')
    expect(suggestMessage([file('a.md'), file('b.md'), file('c.md'), file('d.md')])).toBe(
      'Dokumentace: a.md, b.md a 2 další soubory',
    )
    expect(suggestMessage(Array.from({ length: 7 }, (_, index) => file(`${index}.md`)))).toBe(
      'Dokumentace: 0.md, 1.md a 5 dalších souborů',
    )
  })
})

describe('isValidBranchName', () => {
  it('bere běžná jména', () => {
    for (const name of ['main', 'docs/2026-09-19-1030', 'fix-typo', 'release/v1.2', 'a.b']) {
      expect(isValidBranchName(name), name).toBe(true)
    }
  })

  it('odmítá, co by odmítl git check-ref-format', () => {
    for (const name of [
      '',
      ' ',
      'má mezeru',
      '-začíná-pomlčkou',
      '/lomítko',
      'lomítko/',
      'dvě..tečky',
      'a//b',
      '.tečka',
      'x/.y',
      'konec.',
      'zámek.lock',
      'a~b',
      'a^b',
      'a:b',
      'a?b',
      'a*b',
      'a[b',
      'a\\b',
      'a@{b',
      '@',
      ' okraj',
    ]) {
      expect(isValidBranchName(name), JSON.stringify(name)).toBe(false)
    }
  })
})

describe('běhy', () => {
  it('outcome složí status a conclusion do jednoho semaforu', () => {
    expect(outcome('queued', null)).toBe('queued')
    expect(outcome('in_progress', null)).toBe('running')
    expect(outcome('completed', 'success')).toBe('success')
    expect(outcome('completed', 'failure')).toBe('failure')
    expect(outcome('completed', 'timed_out')).toBe('failure')
    expect(outcome('completed', 'cancelled')).toBe('cancelled')
    expect(outcome('completed', 'skipped')).toBe('skipped')
    expect(outcome('completed', null)).toBe('unknown')
    expect(outcome('cokoli', null)).toBe('unknown')
  })

  it('parseRuns čte přesně to, co vrací gh api', () => {
    const json = JSON.stringify({
      total_count: 1,
      workflow_runs: [
        {
          id: 35431921073,
          name: 'release',
          status: 'completed',
          conclusion: 'success',
          html_url: 'https://github.com/myspulin24/pilcrow/actions/runs/35431921073',
          head_branch: 'v0.6.3',
          head_sha: '9b4ab0e',
          event: 'push',
          created_at: '2026-09-19T08:30:00Z',
          run_number: 42,
        },
        'smetí',
      ],
    })
    expect(parseRuns(json)).toEqual([
      {
        id: 35431921073,
        name: 'release',
        status: 'completed',
        conclusion: 'success',
        url: 'https://github.com/myspulin24/pilcrow/actions/runs/35431921073',
        branch: 'v0.6.3',
        sha: '9b4ab0e',
        event: 'push',
        createdAt: '2026-09-19T08:30:00Z',
        runNumber: 42,
      },
    ])
    expect(parseRuns('')).toEqual([])
    expect(parseRuns('{"workflow_runs":"ne"}')).toEqual([])
  })

  it('parseJobs čte úlohy s kroky', () => {
    const json = JSON.stringify({
      jobs: [
        {
          id: 1,
          name: 'test',
          status: 'in_progress',
          conclusion: null,
          html_url: 'https://github.com/x/y/actions/runs/1/job/1',
          steps: [
            { number: 1, name: 'Set up job', status: 'completed', conclusion: 'success' },
            { number: 7, name: 'Testy', status: 'in_progress', conclusion: null },
          ],
        },
      ],
    })
    const jobs = parseJobs(json)
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.name).toBe('test')
    expect(jobs[0]?.steps).toHaveLength(2)
    expect(jobs[0]?.steps[1]).toEqual({ number: 7, name: 'Testy', status: 'in_progress', conclusion: null })
    expect(parseJobs('{"jobs":[{"id":2,"name":"bez kroků"}]}')[0]?.steps).toEqual([])
  })

  it('settled a overall: nejhorší vyhrává, čeká se na všechny', () => {
    const run = (status: string, conclusion: string | null) => ({
      id: 1,
      name: 'x',
      status,
      conclusion,
      url: '',
      branch: '',
      sha: '',
      event: '',
      createdAt: '',
      runNumber: 1,
    })
    expect(runsSettled([])).toBe(false)
    expect(runsSettled([run('completed', 'success'), run('in_progress', null)])).toBe(false)
    expect(runsSettled([run('completed', 'success'), run('completed', 'skipped')])).toBe(true)

    expect(overallOutcome([])).toBe('unknown')
    expect(overallOutcome([run('completed', 'success'), run('completed', 'failure')])).toBe('failure')
    expect(overallOutcome([run('completed', 'success'), run('in_progress', null)])).toBe('running')
    expect(overallOutcome([run('queued', null)])).toBe('queued')
    expect(overallOutcome([run('completed', 'success'), run('completed', 'skipped')])).toBe('success')
  })
})

describe('přihlášení a průběh', () => {
  it('najde jednorázový kód přesně tak, jak ho gh vypisuje', () => {
    const transcript = '\n! First copy your one-time code: d394-D2F5\nOpen this URL to continue in your web browser: https://github.com/login/device\n'
    expect(findDeviceCode(transcript)).toBe('D394-D2F5')
    expect(findDeviceCode('nic')).toBeNull()
  })

  it('poslední řádek s $ je aktuální krok', () => {
    expect(currentPublishStep('')).toBeNull()
    expect(currentPublishStep('$ git checkout -b docs/x\nSwitched to a new branch\n$ git add -- a.md\n')).toBe(
      'git add -- a.md',
    )
  })
})

describe('workflows', () => {
  const json = JSON.stringify({
    total_count: 2,
    workflows: [
      { id: 1, name: 'release', state: 'active', path: '.github/workflows/release.yml' },
      { id: 2, name: 'starý', state: 'disabled_manually', path: '.github/workflows/old.yml' },
    ],
  })

  it('čte seznam a pozná vypnuté', () => {
    const all = parseWorkflows(json)
    expect(all).toHaveLength(2)
    expect(all[0]).toEqual({ id: 1, name: 'release', state: 'active', path: '.github/workflows/release.yml' })
    expect(activeWorkflows(all).map((w) => w.name)).toEqual(['release'])
  })

  it('repozitář bez workflows vrátí prázdno, ne pád', () => {
    // Přesně případ, kdy nemá smysl čekat na běh: `total_count` je 0.
    expect(parseWorkflows('{"total_count":0,"workflows":[]}')).toEqual([])
    expect(parseWorkflows('')).toEqual([])
    expect(parseWorkflows('{"workflows":"ne"}')).toEqual([])
    expect(activeWorkflows([])).toEqual([])
  })
})

describe('pull request', () => {
  it('název je první řádek commitu, popis zbytek', () => {
    expect(suggestPrTitle('Dokumentace: README.md')).toBe('Dokumentace: README.md')
    expect(suggestPrBody('Dokumentace: README.md')).toBe('')

    const multi = 'Dokumentace: README.md\n\nUpřesnil jsem instalaci.\nA opravil překlep.'
    expect(suggestPrTitle(multi)).toBe('Dokumentace: README.md')
    expect(suggestPrBody(multi)).toBe('Upřesnil jsem instalaci.\nA opravil překlep.')
    expect(suggestPrTitle('')).toBe('')
  })

  it('pozná adresu hotového PR', () => {
    expect(isPrUrl('https://github.com/myspulin24/Notes_MJ/pull/1')).toBe(true)
    expect(isPrUrl('  https://github.com/a/b/pull/42  ')).toBe(true)
    expect(isPrUrl('https://github.com/a/b/compare/main...x')).toBe(false)
    expect(isPrUrl('Warning: something\nhttps://github.com/a/b/pull/1')).toBe(false)
    expect(isPrUrl('')).toBe(false)
  })
})

describe('sloučení pull requestu', () => {
  const PR = JSON.stringify([
    {
      number: 2,
      title: 'Dokumentace: README.md',
      url: 'https://github.com/myspulin24/Notes_MJ/pull/2',
      state: 'OPEN',
      isDraft: false,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      baseRefName: 'main',
      headRefName: 'docs/2026-09-19-1632',
    },
  ])

  it('přečte otevřený PR přesně tak, jak ho vrací gh', () => {
    expect(parsePullRequest(PR)).toEqual({
      number: 2,
      title: 'Dokumentace: README.md',
      url: 'https://github.com/myspulin24/Notes_MJ/pull/2',
      state: 'OPEN',
      isDraft: false,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      baseRefName: 'main',
      headRefName: 'docs/2026-09-19-1632',
    })
  })

  it('prázdný seznam i smetí jsou null, ne pád', () => {
    expect(parsePullRequest('[]')).toBeNull()
    expect(parsePullRequest('')).toBeNull()
    expect(parsePullRequest('[{"title":"bez čísla"}]')).toBeNull()
  })

  it('mergeBlocker pojmenuje, proč sloučit nejde', () => {
    const pr = parsePullRequest(PR)!
    expect(mergeBlocker(pr)).toBeNull()
    expect(mergeBlocker(null)).toBe('none')
    expect(mergeBlocker({ ...pr, state: 'MERGED' })).toBe('closed')
    expect(mergeBlocker({ ...pr, isDraft: true })).toBe('draft')
    expect(mergeBlocker({ ...pr, mergeable: 'CONFLICTING' })).toBe('conflict')
    expect(mergeBlocker({ ...pr, mergeStateStatus: 'DIRTY' })).toBe('conflict')
    expect(mergeBlocker({ ...pr, mergeStateStatus: 'BLOCKED' })).toBe('blocked')
    // Neprošlé kontroly sloučení nebrání -- GitHub je jen označí.
    expect(mergeBlocker({ ...pr, mergeStateStatus: 'UNSTABLE' })).toBeNull()
  })

  it('čte povolené způsoby sloučení a vybírá výchozí', () => {
    const all = parseMergeMethods('{"allow_merge_commit":true,"allow_squash_merge":true,"allow_rebase_merge":true}')
    expect(all).toEqual({ merge: true, squash: true, rebase: true })
    expect(defaultMergeMethod(all)).toBe('squash')

    const noSquash = parseMergeMethods('{"allow_merge_commit":true,"allow_squash_merge":false,"allow_rebase_merge":true}')
    expect(noSquash.squash).toBe(false)
    expect(defaultMergeMethod(noSquash)).toBe('merge')
    expect(defaultMergeMethod({ merge: false, squash: false, rebase: true })).toBe('rebase')
  })

  it('když se nastavení repozitáře přečíst nedá, nabídnou se všechny', () => {
    // Lepší než nenabídnout nic: nepovolený způsob odmítne GitHub a uživatel
    // uvidí proč.
    expect(parseMergeMethods('')).toEqual({ merge: true, squash: true, rebase: true })
    expect(parseMergeMethods('nesmysl')).toEqual({ merge: true, squash: true, rebase: true })
  })
})
