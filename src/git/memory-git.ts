/**
 * Git bez procesů.
 *
 * Pro prohlížeč (`npm run dev:web`), pro testy a všude, kde `git` není.
 * Není to atrapa: vrací výstup ve stejném tvaru jako skutečné nástroje --
 * `git status -z` s nulami, JSON z `gh api` s `workflow_runs` a `jobs` --
 * takže testy procházejí stejnými parsery jako aplikace. A drží stejná
 * pravidla: bez `gh` se nesledují běhy, bez přihlášení taky ne, a běh se po
 * pushi neobjeví hned.
 */

import type { GhProbe, GitProbe } from '@/core'
import type { CloneInput, CreatePrInput, GitApi, GitChunk, GitSink, PublishInput } from './api'

/** Repozitář na „GitHubu“, jak ho vrátí paměťová implementace. */
export interface MemoryRepo {
  fullName: string
  description?: string
  language?: string
  sizeKb?: number
  private?: boolean
  canPush?: boolean
}

export interface MemoryChange {
  /** Cesta od kořene repa. */
  path: string
  /** Dva znaky stavu, jak je píše git: ` M`, `??`, `D `, … */
  xy: string
}

export interface MemoryGitOptions {
  available?: boolean
  gitInstalled?: boolean
  ghInstalled?: boolean
  loggedIn?: boolean
  login?: string
  /** `null` = žádná složka není v repu. Výchozí: otevřená složka je kořen repa. */
  repoRoot?: string | null
  branch?: string
  /** Výchozí větev repozitáře; do ní míří PR. Prázdná = nezjištěná. */
  defaultBranch?: string
  remoteUrl?: string
  /** `false` = git nezná jméno a e-mail. */
  identity?: boolean
  changes?: MemoryChange[]
  /** Po kolika dotazech se běh po pushi objeví. */
  runAppearsAfter?: number
  /** Kolik dotazů běh běží, než doběhne. */
  runTicks?: number
  runConclusion?: 'success' | 'failure'
  workflowName?: string
  /** Nechat push selhat s touhle zprávou. Dá se za běhu smazat a zkusit znovu. */
  failPush?: string
  /** Repozitáře, které „GitHub“ vrátí ve výběru. */
  repos?: MemoryRepo[]
  /** Co už leží ve složce s repozitáři: cesta -> remote. */
  clones?: Record<string, string>
  /**
   * Kolik workflows repozitář má. `0` je poctivý stav, ne chyba: takový
   * repozitář žádný běh nespustí a nemá smysl na něj čekat.
   */
  workflowCount?: number
  /** Nechat založení PR selhat s touhle zprávou. */
  failPr?: string
  /** Nechat stahování selhat s touhle zprávou. */
  failClone?: string
  /**
   * Zastavit stahování v půlce, dokud test nezavolá `finishClone`.
   *
   * Bez toho se klon dokončí dřív, než se dá ukazatel průběhu vůbec vykreslit,
   * a test by tvrdil, že ho viděl, aniž by ho viděl.
   */
  holdClone?: boolean
}

const STEPS = ['Set up job', 'Run actions/checkout@v4', 'Instalace závislostí', 'Testy', 'Complete job']

function sha(seed: number): string {
  return seed.toString(16).padStart(8, '0').repeat(5)
}

export class MemoryGit implements GitApi {
  readonly available: boolean
  readonly pollMs = 25

  /** Co se otevřelo v prohlížeči, k ověření v testech. */
  readonly opened: string[] = []
  /** Poslední odeslání, k ověření v testech. */
  published: { branch: string; message: string; files: string[] } | null = null
  /** Poslední založené PR, k ověření v testech. */
  createdPr: CreatePrInput | null = null
  /** Poslední stahování, k ověření v testech. */
  cloned: (CloneInput & { target: string }) | null = null
  /** Dokončit zadržené stahování. `null`, když žádné neběží. */
  finishClone: (() => void) | null = null
  /** Zpráva, se kterou má push selhat. Prázdné = projde. */
  failPush: string

  private readonly options: MemoryGitOptions
  private loggedIn: boolean
  private branch: string
  private headSha = sha(0xa1b2c3d4)
  private changes: MemoryChange[]
  private runQueries = 0
  private runSha: string | null = null
  private loginSink: GitSink | null = null
  private cancelled = false

  constructor(options: MemoryGitOptions = {}) {
    this.options = options
    this.available = options.available ?? true
    this.loggedIn = options.loggedIn ?? true
    this.branch = options.branch ?? 'main'
    this.changes = [...(options.changes ?? [])]
    this.failPush = options.failPush ?? ''
  }

  /** Označit soubor jako změněný, jako by ho někdo přepsal. */
  markChanged(path: string, xy = ' M'): void {
    if (!this.changes.some((change) => change.path === path)) this.changes.push({ path, xy })
  }

  /** Dokončit rozběhnuté přihlašování, jako by uživatel zadal kód v prohlížeči. */
  completeLogin(): void {
    const sink = this.loginSink
    this.loginSink = null
    if (!sink) return
    this.loggedIn = true
    sink({ kind: 'out', text: '✓ Authentication complete.\n' })
    sink({ kind: 'finished' })
  }

  async probe(folder: string): Promise<GitProbe> {
    const gitInstalled = this.options.gitInstalled ?? true
    const ghInstalled = this.options.ghInstalled ?? true
    const repoRoot = this.options.repoRoot === null ? '' : (this.options.repoRoot ?? folder)
    const identity = this.options.identity ?? true
    return {
      gitInstalled,
      gitVersion: gitInstalled ? 'git version 2.50.0 (Pilcrow, paměťová implementace)' : '',
      gitPath: gitInstalled ? 'git' : '',
      ghInstalled,
      ghVersion: ghInstalled ? 'gh version 2.92.0' : '',
      ghPath: ghInstalled ? 'gh' : '',
      ghAuth: ghInstalled
        ? JSON.stringify({
            hosts: this.loggedIn
              ? {
                  'github.com': [
                    {
                      state: 'success',
                      active: true,
                      host: 'github.com',
                      login: this.options.login ?? 'tester',
                      scopes: 'gist, read:org, repo, workflow',
                    },
                  ],
                }
              : {},
          })
        : '',
      repoRoot: gitInstalled ? repoRoot : '',
      branch: gitInstalled && repoRoot ? this.branch : '',
      defaultBranch: gitInstalled && repoRoot ? (this.options.defaultBranch ?? 'main') : '',
      headSha: gitInstalled && repoRoot ? this.headSha : '',
      remoteUrl: gitInstalled && repoRoot ? (this.options.remoteUrl ?? 'https://github.com/tester/docs.git') : '',
      userName: identity ? 'Tester' : '',
      userEmail: identity ? 'tester@example.com' : '',
      gitInstallCommand: 'winget install --id Git.Git',
      ghInstallCommand: 'winget install --id GitHub.cli',
      error: '',
    }
  }

  async status(): Promise<string> {
    // Přesně tvar `-z`: dva znaky, mezera, cesta, nula.
    return this.changes.map((change) => `${change.xy} ${change.path}\0`).join('')
  }

  async publish(input: PublishInput, sink: GitSink): Promise<void> {
    this.cancelled = false
    const say = (text: string) => sink({ kind: 'out', text })

    say(`$ git checkout -b ${input.branch}\n`)
    say(`Switched to a new branch '${input.branch}'\n`)
    this.branch = input.branch
    if (this.cancelled) return

    say(`$ git add -- ${input.files.join(' ')}\n`)
    say('$ git commit\n')
    this.headSha = sha(0xb2c3d4e5 + this.runQueries)
    say(`[${input.branch} ${this.headSha.slice(0, 7)}] ${input.message}\n`)
    this.changes = this.changes.filter((change) => !input.files.includes(change.path))
    this.published = { branch: input.branch, message: input.message, files: [...input.files] }

    await this.doPush(input.branch, sink)
  }

  async push(_folder: string, branch: string, sink: GitSink): Promise<void> {
    this.cancelled = false
    await this.doPush(branch, sink)
  }

  private async doPush(branch: string, sink: GitSink): Promise<void> {
    sink({ kind: 'out', text: `$ git push -u origin ${branch}\n` })
    if (this.failPush) {
      sink({ kind: 'out', text: `fatal: ${this.failPush}\n` })
      sink({ kind: 'failed', message: this.failPush })
      return
    }
    sink({ kind: 'out', text: `To ${this.options.remoteUrl ?? 'https://github.com/tester/docs.git'}\n` })
    sink({ kind: 'out', text: ` * [new branch]      ${branch} -> ${branch}\n` })
    // Běh se na GitHubu objeví až za chvíli; počítá se od pushe.
    this.runQueries = 0
    this.runSha = this.headSha
    sink({ kind: 'finished' })
  }

  async cancel(): Promise<void> {
    this.cancelled = true
  }

  private run(status: string, conclusion: string | null, id = 1001) {
    return {
      id,
      name: this.options.workflowName ?? 'ci',
      status,
      conclusion,
      html_url: `https://github.com/tester/docs/actions/runs/${id}`,
      head_branch: this.branch,
      head_sha: this.headSha,
      event: 'push',
      created_at: '2026-09-19T10:00:00Z',
      run_number: 7,
    }
  }

  /** Kde běh zrovna je: `null` ještě nikde, jinak kolikátý tik od objevení. */
  private tick(): number | null {
    const appearsAfter = this.options.runAppearsAfter ?? 1
    if (this.runQueries < appearsAfter) return null
    return this.runQueries - appearsAfter
  }

  async runs(_folder: string, headSha: string): Promise<string> {
    if (!this.loggedIn) throw new Error('gh: To get started with GitHub CLI, please run: gh auth login')
    if (headSha !== this.runSha) return JSON.stringify({ total_count: 0, workflow_runs: [] })

    this.runQueries += 1
    const tick = this.tick()
    if (tick === null) return JSON.stringify({ total_count: 0, workflow_runs: [] })

    const ticks = this.options.runTicks ?? 2
    const done = tick >= ticks
    const run = done
      ? this.run('completed', this.options.runConclusion ?? 'success')
      : this.run(tick === 0 ? 'queued' : 'in_progress', null)
    return JSON.stringify({ total_count: 1, workflow_runs: [run] })
  }

  async jobs(): Promise<string> {
    const tick = this.tick() ?? 0
    const ticks = this.options.runTicks ?? 2
    const done = tick >= ticks
    const failed = done && this.options.runConclusion === 'failure'
    // Kroky se dokončují postupně, jak tiky přibývají; při neúspěchu spadne ten poslední hotový.
    const finished = done ? STEPS.length : Math.min(STEPS.length, Math.floor((tick / ticks) * STEPS.length))
    const steps = STEPS.map((name, index) => {
      const number = index + 1
      if (index < finished) {
        const isLast = failed && index === finished - 1
        return { number, name, status: 'completed', conclusion: isLast ? 'failure' : 'success' }
      }
      if (index === finished && !done) return { number, name, status: 'in_progress', conclusion: null }
      return { number, name, status: done ? 'completed' : 'queued', conclusion: done ? 'skipped' : null }
    })
    return JSON.stringify({
      total_count: 1,
      jobs: [
        {
          id: 5001,
          name: 'test',
          status: done ? 'completed' : 'in_progress',
          conclusion: done ? (failed ? 'failure' : 'success') : null,
          html_url: 'https://github.com/tester/docs/actions/runs/1001/job/5001',
          steps,
        },
      ],
    })
  }

  async workflows(): Promise<string> {
    if (!this.loggedIn) throw new Error('gh: To get started with GitHub CLI, please run: gh auth login')
    const count = this.options.workflowCount ?? 1
    return JSON.stringify({
      total_count: count,
      workflows: Array.from({ length: count }, (_, index) => ({
        id: 900 + index,
        name: index === 0 ? (this.options.workflowName ?? 'ci') : `workflow-${index}`,
        state: 'active',
        path: `.github/workflows/w${index}.yml`,
      })),
    })
  }

  async createPr(input: CreatePrInput): Promise<string> {
    if (!this.loggedIn) throw new Error('gh: To get started with GitHub CLI, please run: gh auth login')
    if (this.options.failPr) throw new Error(this.options.failPr)
    this.createdPr = { ...input }
    return 'https://github.com/tester/docs/pull/7'
  }

  async recentRuns(): Promise<string> {
    if (!this.loggedIn) throw new Error('gh: To get started with GitHub CLI, please run: gh auth login')
    return JSON.stringify({
      total_count: 2,
      workflow_runs: [this.run('completed', 'success', 1000), this.run('completed', 'failure', 999)],
    })
  }

  async login(sink: GitSink): Promise<void> {
    if (!(this.options.ghInstalled ?? true)) {
      sink({ kind: 'failed', message: 'GitHub CLI není nainstalované.' })
      return
    }
    this.loginSink = sink
    sink({ kind: 'out', text: '$ gh auth login --web\n' })
    sink({ kind: 'out', text: '\n! First copy your one-time code: D394-D2F5\n' })
    sink({ kind: 'out', text: 'Open this URL to continue in your web browser: https://github.com/login/device\n' })
  }

  async loginCancel(): Promise<void> {
    this.loginSink = null
  }

  async openUrl(url: string): Promise<void> {
    this.opened.push(url)
  }

  // -- výběr repozitáře -------------------------------------------------------

  async ghStatus(): Promise<GhProbe> {
    const installed = this.options.ghInstalled ?? true
    return {
      installed,
      version: installed ? 'gh version 2.92.0' : '',
      auth: installed
        ? JSON.stringify({
            hosts: this.loggedIn
              ? {
                  'github.com': [
                    {
                      state: 'success',
                      active: true,
                      host: 'github.com',
                      login: this.options.login ?? 'tester',
                      scopes: 'gist, read:org, repo, workflow',
                    },
                  ],
                }
              : {},
          })
        : '',
      installCommand: 'winget install --id GitHub.cli',
      error: '',
    }
  }

  async repos(): Promise<string> {
    if (!this.loggedIn) throw new Error('gh: To get started with GitHub CLI, please run: gh auth login')
    // Tvar REST, ne ten z `gh repo list` -- stejně jako doopravdy.
    return JSON.stringify(
      (this.options.repos ?? []).map((repo, index) => ({
        full_name: repo.fullName,
        description: repo.description ?? null,
        language: repo.language ?? null,
        size: repo.sizeKb ?? 100,
        default_branch: 'main',
        updated_at: `2026-09-${String(19 - index).padStart(2, '0')}T10:00:00Z`,
        clone_url: `https://github.com/${repo.fullName}.git`,
        private: repo.private ?? false,
        fork: false,
        archived: false,
        permissions: { admin: true, push: repo.canPush ?? true, pull: true },
      })),
    )
  }

  async clones(folder: string): Promise<string> {
    const prefix = folder.replace(/[\\/]+$/, '')
    return JSON.stringify(
      Object.entries(this.options.clones ?? {})
        .filter(([path]) => path.startsWith(prefix))
        .map(([path, remote]) => ({ path, remote })),
    )
  }

  async clone(input: CloneInput, sink: GitSink): Promise<string> {
    const target = `${input.parent.replace(/[\\/]+$/, '')}/${input.folder}`
    this.cloned = { ...input, target }
    const say = (text: string) => sink({ kind: 'out', text })

    say(`$ gh repo clone ${input.repo}\n`)
    say(`Cloning into '${input.folder}'...\n`)
    if (this.options.failClone) {
      sink({ kind: 'failed', message: this.options.failClone })
      return target
    }
    // Průběh odděluje návrat vozíku, přesně jako `git clone --progress`.
    say('Receiving objects:   0% (1/683)\rReceiving objects:  50% (342/683)\r')

    if (this.options.holdClone) {
      this.finishClone = () => {
        this.finishClone = null
        say('Receiving objects: 100% (683/683), 832.29 KiB | 2.48 MiB/s, done.\r')
        sink({ kind: 'finished' })
      }
      return target
    }

    say('Receiving objects: 100% (683/683), 832.29 KiB | 2.48 MiB/s, done.\r')
    sink({ kind: 'finished' })
    return target
  }
}

export type { GitChunk }
