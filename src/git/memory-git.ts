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
import type {
  CloneInput,
  CreatePrInput,
  GitApi,
  GitChunk,
  GitSink,
  LinkInput,
  MergePrInput,
  PublishInput,
} from './api'

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

/** Větev, jak ji „vidí“ paměťový git. */
export interface MemoryBranch {
  name: string
  /** Je doma. Výchozí: jen ta, na které se stojí, a výchozí větev. */
  local?: boolean
  /** Je na GitHubu. Výchozí: ano. */
  remote?: boolean
  subject?: string
  author?: string
  /** ISO 8601. */
  date?: string
  /** Kolik commitů má větev navíc proti výchozí. */
  ahead?: number
  /** Kolik jí chybí z výchozí. */
  behind?: number
  /** Kolik commitů má GitHub navíc proti domácí kopii. */
  behindRemote?: number
  /** Soubory, které větev změnila proti výchozí. */
  files?: Array<{ path: string; status?: 'A' | 'M' | 'D' }>
}

/** Co je vybraná složka zač, když se ptá „soubory mám jinde“. */
export interface MemoryFolder {
  /** Kořen repa, ve kterém složka leží. Chybí = obyčejná složka. */
  root?: string
  remote?: string
  markdownFiles?: number
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
  /**
   * Otevřený PR, který na GitHubu existoval, ještě než se aplikace spustila.
   *
   * Modeluje situaci po restartu: uživatel odeslal a založil PR minule,
   * aplikace o tom nic neví a musí si ho najít podle větve.
   */
  existingPr?: { number: number; branch: string; base?: string; title?: string }
  /**
   * Jak daleko je remote napřed. Modeluje repozitář, do kterého mezitím
   * někdo přispěl.
   */
  behind?: number
  /** Kolik commitů má lokál navíc. */
  ahead?: number
  /** Nechat zjištění stavu selhat -- například bez sítě. */
  failSync?: string
  /** Nechat stažení selhat. */
  failPull?: string
  /** Stav PR, který „GitHub“ hlásí pro odeslanou větev. */
  prState?: { mergeable?: string; mergeStateStatus?: string; isDraft?: boolean; state?: string }
  /** Které způsoby sloučení repozitář povoluje. */
  mergeMethods?: { merge?: boolean; squash?: boolean; rebase?: boolean }
  /** Nechat sloučení selhat s touhle zprávou. */
  failMerge?: string
  /** Nechat stahování selhat s touhle zprávou. */
  failClone?: string
  /**
   * Zastavit stahování v půlce, dokud test nezavolá `finishClone`.
   *
   * Bez toho se klon dokončí dřív, než se dá ukazatel průběhu vůbec vykreslit,
   * a test by tvrdil, že ho viděl, aniž by ho viděl.
   */
  holdClone?: boolean
  /** Větve na „GitHubu“ i doma. Výchozí: jen výchozí větev a ta, na které se stojí. */
  branches?: MemoryBranch[]
  /** Nechat přepnutí větve selhat s touhle zprávou. */
  failSwitch?: string
  /** Složky, které se dají vybrat jako „soubory mám jinde“: cesta -> co to je. */
  folders?: Record<string, MemoryFolder>
  /** Čím se napojená složka liší od main -- změny, které po napojení uvidí git. */
  linkChanges?: MemoryChange[]
  /** Nechat napojení selhat s touhle zprávou. */
  failLink?: string
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
  /** Poslední sloučení, k ověření v testech. */
  merged: MergePrInput | null = null
  /** Stáhlo se? K ověření v testech. */
  pulled = false
  /** Kolikrát se ptalo na stav remote. K ověření v testech. */
  syncCalls = 0
  /** Kolik commitů je remote napřed; stažením klesne na nulu. */
  private behind: number
  /** Poslední stahování, k ověření v testech. */
  cloned: (CloneInput & { target: string }) | null = null
  /** Dokončit zadržené stahování. `null`, když žádné neběží. */
  finishClone: (() => void) | null = null
  /** Zpráva, se kterou má push selhat. Prázdné = projde. */
  failPush: string
  /** Na které větve se přepínalo, v pořadí. K ověření v testech. */
  readonly switched: string[] = []
  /** Poslední vrácení souborů, k ověření v testech. */
  restored: { source: string; files: string[] } | null = null
  /** Poslední napojení složky, k ověření v testech. */
  linked: LinkInput | null = null
  /** Na co se ptalo porovnání, v pořadí. K ověření v testech. */
  readonly compared: string[] = []
  /** Režim posledního odeslání, k ověření v testech. */
  publishedMode: 'new' | 'existing' | null = null
  /** Napojené složky: od napojení jsou kořenem vlastního repa. */
  private readonly linkedRoots = new Set<string>()
  private branchList: MemoryBranch[]

  /**
   * Složky, na které se aplikace ptala, v pořadí.
   *
   * Otevřených složek může být víc a stav gitu patří té aktivní; tohle je
   * jediný způsob, jak v testu ověřit, že se opravdu ptá na ni.
   */
  readonly probedFolders: string[] = []

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
    this.behind = options.behind ?? 0
    const main = options.defaultBranch ?? 'main'
    this.branchList = options.branches
      ? options.branches.map((branch) => ({ ...branch }))
      : [{ name: main, local: true }, ...(this.branch !== main ? [{ name: this.branch, local: true }] : [])]
    // Na té, na které se stojí, se stojí doma -- ať to test napíše, nebo ne.
    for (const branch of this.branchList) {
      if (branch.name === this.branch || branch.name === main) branch.local = branch.local ?? true
    }
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
    this.probedFolders.push(folder)
    const gitInstalled = this.options.gitInstalled ?? true
    const ghInstalled = this.options.ghInstalled ?? true
    const repoRoot = this.linkedRoots.has(folder)
      ? folder
      : this.options.repoRoot === null
        ? ''
        : (this.options.repoRoot ?? folder)
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
    this.publishedMode = input.mode ?? 'new'

    if (input.mode === 'existing') {
      if (input.branch !== this.branch) {
        const known = this.branchList.find((branch) => branch.name === input.branch)
        if (!known) throw new Error(`Větev ${input.branch} není ani tady, ani na GitHubu.`)
        say(`$ git switch ${input.branch}\n`)
        known.local = true
        this.branch = input.branch
      }
    } else {
      say(`$ git checkout -b ${input.branch}\n`)
      say(`Switched to a new branch '${input.branch}'\n`)
      this.branch = input.branch
      this.branchList.push({ name: input.branch, local: true, remote: false, subject: input.message })
    }
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
    const pushed = this.branchList.find((known) => known.name === branch)
    if (pushed) pushed.remote = true
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

  async syncState(): Promise<string> {
    this.syncCalls += 1
    return JSON.stringify({
      branch: this.branch,
      upstream: this.options.defaultBranch === null ? '' : `origin/${this.branch}`,
      ahead: this.options.ahead ?? 0,
      behind: this.behind,
      dirty: this.changes.length,
      error: this.options.failSync ?? '',
    })
  }

  async pull(_folder: string, sink: GitSink): Promise<void> {
    sink({ kind: 'out', text: '$ git pull --ff-only\n' })
    if (this.options.failPull) {
      sink({ kind: 'failed', message: this.options.failPull })
      return
    }
    sink({ kind: 'out', text: `Fast-forward ${this.behind} commitů\n` })
    this.pulled = true
    this.behind = 0
    const current = this.branchNamed(this.branch)
    if (current) current.behindRemote = 0
    sink({ kind: 'finished' })
  }

  async pullRequest(_folder: string, branch: string): Promise<string> {
    if (!this.loggedIn) throw new Error('gh: To get started with GitHub CLI, please run: gh auth login')
    if (this.merged) return '[]'
    const existing = this.options.existingPr
    const found =
      this.createdPr && this.createdPr.head === branch
        ? { number: 7, title: this.createdPr.title, base: this.createdPr.base, head: branch }
        : existing && existing.branch === branch
          ? {
              number: existing.number,
              title: existing.title ?? 'Dokumentace',
              base: existing.base ?? 'main',
              head: branch,
            }
          : null
    if (!found) return '[]'

    const s = this.options.prState ?? {}
    return JSON.stringify([
      {
        number: found.number,
        title: found.title,
        url: `https://github.com/tester/docs/pull/${found.number}`,
        state: s.state ?? 'OPEN',
        isDraft: s.isDraft ?? false,
        mergeable: s.mergeable ?? 'MERGEABLE',
        mergeStateStatus: s.mergeStateStatus ?? 'CLEAN',
        baseRefName: found.base,
        headRefName: found.head,
      },
    ])
  }

  async mergeMethods(): Promise<string> {
    const m = this.options.mergeMethods ?? {}
    return JSON.stringify({
      allow_merge_commit: m.merge ?? true,
      allow_squash_merge: m.squash ?? true,
      allow_rebase_merge: m.rebase ?? true,
    })
  }

  async mergePr(input: MergePrInput, sink: GitSink): Promise<void> {
    const say = (text: string) => sink({ kind: 'out', text })
    say(`$ gh pr merge ${input.number} --${input.method}\n`)
    if (this.options.failMerge) {
      sink({ kind: 'failed', message: this.options.failMerge })
      return
    }
    this.merged = { ...input }
    say(`✓ Merged pull request #${input.number}\n`)
    say(`$ git checkout ${input.base}\n`)
    this.branch = input.base
    say('$ git pull --ff-only\n')
    if (input.deleteBranch) say(`$ git push origin --delete ${input.head}\n`)
    sink({ kind: 'finished' })
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

  async clones(folder: string, extra: string[] = []): Promise<string> {
    const prefix = folder.replace(/[\\/]+$/, '')
    const known = { ...(this.options.clones ?? {}), ...this.madeClones }
    return JSON.stringify(
      Object.entries(known)
        .filter(([path]) => (prefix !== '' && path.startsWith(`${prefix}/`)) || extra.includes(path))
        .map(([path, remote]) => ({ path, remote })),
    )
  }

  /** Repozitáře, které vznikly za běhu: stažené nebo napojené. Cesta -> remote. */
  private readonly madeClones: Record<string, string> = {}

  async clone(input: CloneInput, sink: GitSink): Promise<string> {
    const target = `${input.parent.replace(/[\\/]+$/, '')}/${input.folder}`
    this.cloned = { ...input, target }
    if (!this.options.failClone) this.madeClones[target] = `https://github.com/${input.repo}.git`
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

  // -- větve ------------------------------------------------------------------

  private get defaultBranch(): string {
    return this.options.defaultBranch ?? 'main'
  }

  private branchNamed(name: string): MemoryBranch | undefined {
    return this.branchList.find((branch) => branch.name === name.replace(/^origin\//, ''))
  }

  /** Přesně tvar `git_branches`: `for-each-ref` s nulami mezi poli. */
  async branches(): Promise<string> {
    const line = (refname: string, branch: MemoryBranch, upstream: string, track: string) =>
      [
        refname,
        sha(branch.name.length * 7919).slice(0, 7),
        branch.date ?? '2026-09-20T10:00:00+02:00',
        branch.author ?? 'Tester',
        upstream,
        track,
        branch.subject ?? `Poslední commit na ${branch.name}`,
      ].join('\0')

    const refs: string[] = []
    for (const branch of this.branchList) {
      const remote = branch.remote ?? true
      if (branch.local) {
        // U větve, na které se stojí, je „pozadu“ totéž, co hlásí stav proti remote.
        const behind = branch.behindRemote ?? (branch.name === this.branch ? this.behind : 0)
        const track = remote && behind ? `behind ${behind}` : ''
        refs.push(line(`refs/heads/${branch.name}`, branch, remote ? `origin/${branch.name}` : '', track))
      }
      if (remote) refs.push(line(`refs/remotes/origin/${branch.name}`, branch, '', ''))
    }
    refs.push(line('refs/remotes/origin/HEAD', { name: this.defaultBranch }, '', ''))

    return JSON.stringify({
      current: this.branch,
      default: this.defaultBranch,
      fetchError: this.options.failSync ?? '',
      refs: `${refs.join('\n')}\n`,
    })
  }

  async branchLog(_folder: string, _base: string, target: string): Promise<string> {
    const branch = this.branchNamed(target)
    if (!branch) throw new Error(`fatal: ambiguous argument '${target}': unknown revision`)
    const files = branch.files ?? []
    const ahead = branch.ahead ?? (branch.name === this.defaultBranch ? 0 : 1)
    return JSON.stringify({
      ahead,
      behind: branch.behind ?? 0,
      log: Array.from({ length: ahead }, (_, index) =>
        [sha(0xc0ffee + index).slice(0, 7), branch.author ?? 'Tester', branch.date ?? '2026-09-20T10:00:00+02:00', index === 0 ? (branch.subject ?? `Poslední commit na ${branch.name}`) : `Starší commit ${index}`].join('\0'),
      ).join('\n'),
      nameStatus: files.map((file) => `${file.status ?? 'M'}\0${file.path}\0`).join(''),
      numstat: files.map((file) => `${file.status === 'D' ? 0 : 3}\t${file.status === 'A' ? 0 : 1}\t${file.path}\0`).join(''),
    })
  }

  /** Rozdíly, na které se okno ptalo. K ověření v testech. */
  readonly diffs: Array<{ from: string; to: string; path: string }> = []

  async diff(_folder: string, from: string, to: string, path: string): Promise<string> {
    this.diffs.push({ from, to, path })
    return [
      `diff --git a/${path} b/${path}`,
      'index 1111111..2222222 100644',
      `--- a/${path}`,
      `+++ b/${path}`,
      '@@ -1,2 +1,2 @@',
      ' # Nadpis',
      '-stará věta',
      '+nová věta',
      '',
    ].join('\n')
  }

  async switchBranch(_folder: string, name: string, sink: GitSink): Promise<void> {
    const branch = this.branchNamed(name)
    if (!branch) throw new Error(`Větev ${name} není ani tady, ani na GitHubu.`)
    const say = (text: string) => sink({ kind: 'out', text })
    say(branch.local ? `$ git switch ${name}\n` : `$ git switch -c ${name} --track origin/${name}\n`)
    if (this.options.failSwitch) {
      sink({ kind: 'failed', message: this.options.failSwitch })
      return
    }
    this.switched.push(name)
    branch.local = true
    this.branch = name
    if (branch.behindRemote) {
      say(`$ git merge --ff-only origin/${name}\n`)
      branch.behindRemote = 0
    }
    // Na jiné větvi je jiný stav proti GitHubu -- ten výchozí už neplatí.
    this.behind = 0
    sink({ kind: 'finished' })
  }

  // -- porovnání s výchozí větví ----------------------------------------------

  /** Tvar `git_compare`, spočítaný z rozdělaných změn -- ty jsou po napojení přesně rozdílem proti main. */
  async compare(_folder: string, base: string): Promise<string> {
    this.compared.push(base)
    if (this.options.failSync && !this.linked) throw new Error(this.options.failSync)
    const tracked = this.changes.filter((change) => change.xy !== '??')
    const untracked = this.changes.filter((change) => change.xy === '??')
    const status = (xy: string) => (xy.includes('D') ? 'D' : xy.includes('A') ? 'A' : 'M')
    return JSON.stringify({
      base,
      branch: this.branch,
      ahead: this.options.ahead ?? 0,
      behind: this.behind,
      nameStatus: tracked.map((change) => `${status(change.xy)}\0${change.path}\0`).join(''),
      numstat: tracked.map((change) => `${change.xy.includes('D') ? 0 : 2}\t1\t${change.path}\0`).join(''),
      untracked: untracked.map((change) => `${change.path}\0`).join(''),
      fetchError: '',
    })
  }

  async restore(_folder: string, source: string, files: string[]): Promise<void> {
    this.restored = { source, files: [...files] }
    this.changes = this.changes.filter((change) => !files.includes(change.path))
  }

  // -- napojení složky --------------------------------------------------------

  async inspectFolder(folder: string): Promise<string> {
    const known = this.options.folders?.[folder] ?? {}
    return JSON.stringify({
      root: known.root ?? '',
      remote: known.remote ?? '',
      isRoot: !!known.root && known.root === folder,
      markdownFiles: known.markdownFiles ?? 3,
    })
  }

  async linkFolder(input: LinkInput, sink: GitSink): Promise<void> {
    const say = (text: string) => sink({ kind: 'out', text })
    say('$ git init\n')
    say(`$ git remote add origin ${input.remoteUrl}\n`)
    say('$ git fetch origin\n')
    if (this.options.failLink) {
      sink({ kind: 'failed', message: this.options.failLink })
      return
    }
    say(`$ git update-ref refs/heads/${input.defaultBranch} origin/${input.defaultBranch}\n`)
    say('$ git reset\n')
    this.linked = { ...input }
    this.linkedRoots.add(input.folder)
    this.madeClones[input.folder] = input.remoteUrl
    this.branch = input.defaultBranch
    this.behind = 0
    this.changes = [...(this.options.linkChanges ?? [])]
    sink({ kind: 'finished' })
  }
}

export type { GitChunk }
