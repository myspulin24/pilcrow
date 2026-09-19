/**
 * Git a GitHub Actions nad otevřenou složkou -- čistá část.
 *
 * Stejné dělení jako u asistenta: Rust spustí `git` a `gh` a přeposílá, co
 * vypsaly; *rozumět* tomu se učí jen tohle jedno místo. Všechno tady jsou
 * funkce bez vedlejších účinků, takže se testují bez repozitáře a bez sítě.
 *
 * Dvě pravidla, kvůli kterým tohle existuje odděleně od průzkumníku:
 *
 *  1. Do commitu jde jen to, co uživatel vidí a má zaškrtnuté. Předvybrané
 *     jsou soubory, které zapsal Pilcrow; cizí rozdělaná práce v repu se
 *     ukáže, ale sama se nevybere.
 *  2. Z GitHubu se jen čte. Běhy Actions se sledují, nikdy nespouštějí.
 */

// -- co Rust zjistil ----------------------------------------------------------

/** Co Rust zjistil o gitu, GitHub CLI a otevřené složce. */
export interface GitProbe {
  gitInstalled: boolean
  gitVersion: string
  gitPath: string
  ghInstalled: boolean
  ghVersion: string
  ghPath: string
  /** Surový JSON z `gh auth status --json hosts`; rozumí mu `parseGhAuth`. */
  ghAuth: string
  /** Kořen repozitáře, ve kterém otevřená složka leží. Prázdné = není v repu. */
  repoRoot: string
  branch: string
  /**
   * Výchozí větev repozitáře. Do ní míří pull requesty.
   *
   * Nesmí se plést s `branch`: ta říká, kde uživatel právě stojí, a po
   * prvním odeslání to je ta `docs/…` větev, kterou pak zmerguje a GitHub
   * smaže -- PR by neměl kam mířit.
   */
  defaultBranch: string
  headSha: string
  /** Adresa `origin`. Prázdná, když repo žádný remote nemá. */
  remoteUrl: string
  userName: string
  userEmail: string
  /** Příkazy k doinstalování, podle systému. Ukazují se, nespouštějí. */
  gitInstallCommand: string
  ghInstallCommand: string
  error: string
}

/**
 * Co Rust zjistil o GitHub CLI, bez ohledu na jakoukoli složku.
 *
 * Repozitář se vybírá dřív, než je co otevřít, takže `GitProbe` -- která
 * začíná složkou -- se na tohle zeptat nedá.
 */
export interface GhProbe {
  installed: boolean
  version: string
  /** Surový JSON z `gh auth status --json hosts`; rozumí mu `parseGhAuth`. */
  auth: string
  installCommand: string
  error: string
}

/** Kde stojí GitHub CLI samo o sobě, mimo kontext otevřené složky. */
export function ghProbeStep(probe: GhProbe | null): 'install' | 'login' | 'ready' {
  if (!probe || !probe.installed) return 'install'
  return parseGhAuth(probe.auth)?.loggedIn ? 'ready' : 'login'
}

/** Kdo je přihlášený v GitHub CLI. */
export interface GhAccount {
  loggedIn: boolean
  login: string
  host: string
  scopes: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value : ''
}

function num(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * Přečíst `gh auth status --json hosts`.
 *
 * Tvar: `{ hosts: { "github.com": [ { state, active, login, scopes, … } ] } }`.
 * Bere se aktivní účet prvního hostitele. Nepřihlášené `gh` vrací prázdné
 * `hosts`, což je poctivé „nikdo“, ne chyba.
 */
export function parseGhAuth(raw: string): GhAccount | null {
  const text = raw.trim()
  if (!text) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(parsed) || !isRecord(parsed.hosts)) return null

  for (const [host, entries] of Object.entries(parsed.hosts)) {
    if (!Array.isArray(entries) || entries.length === 0) continue
    const active = entries.find((entry) => isRecord(entry) && entry.active === true) ?? entries[0]
    if (!isRecord(active)) continue
    const login = str(active, 'login')
    const scopes = str(active, 'scopes')
      .split(',')
      .map((scope) => scope.trim())
      .filter(Boolean)
    return { loggedIn: str(active, 'state') === 'success' && login !== '', login, host, scopes }
  }
  return { loggedIn: false, login: '', host: '', scopes: [] }
}

// -- remote -------------------------------------------------------------------

export interface GitRemote {
  host: string
  owner: string
  repo: string
}

/**
 * Rozebrat adresu remote na hostitele, vlastníka a repo.
 *
 * Bere všechny tři běžné tvary: `https://github.com/o/r.git`,
 * `ssh://git@github.com/o/r.git` i `git@github.com:o/r.git`.
 */
export function parseRemote(url: string): GitRemote | null {
  const text = url.trim()
  if (!text) return null

  let match = /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/.exec(text)
  if (!match) match = /^(?:[^@:/]+@)?([^:/]+):(?!\/)(.+?)(?:\.git)?\/?$/.exec(text)
  if (!match) return null

  const host = match[1] ?? ''
  const parts = (match[2] ?? '').split('/').filter(Boolean)
  const owner = parts[parts.length - 2]
  const repo = parts[parts.length - 1]
  if (!host || !owner || !repo) return null
  return { host: host.toLowerCase(), owner, repo }
}

export function isGitHub(remote: GitRemote | null): boolean {
  return remote?.host === 'github.com'
}

/** Stránka pro založení PR z větve. Uživatel ho tam dopíše a založí sám. */
export function compareUrl(remote: GitRemote, base: string, branch: string): string {
  const seg = (name: string) => name.split('/').map(encodeURIComponent).join('/')
  return `https://${remote.host}/${remote.owner}/${remote.repo}/compare/${seg(base)}...${seg(branch)}?expand=1`
}

export function actionsUrl(remote: GitRemote): string {
  return `https://${remote.host}/${remote.owner}/${remote.repo}/actions`
}

// -- kroky --------------------------------------------------------------------

/** Kde stojí git. UI ukáže jeden krok, ne formulář. */
export type GitStep = 'unsupported' | 'install-git' | 'not-repo' | 'no-remote' | 'identity' | 'ready'

/**
 * Jeden krok napřed, nikdy dva -- stejná logika jako u asistenta.
 *
 * Bez gitu není co zkoumat; složka mimo repo nemá kam pushovat; repo bez
 * remote taky ne; a commit bez jména a e-mailu git odmítne. Teprve pak
 * „připraveno“.
 */
export function gitStep(probe: GitProbe | null, supported: boolean): GitStep {
  if (!supported) return 'unsupported'
  if (!probe || !probe.gitInstalled) return 'install-git'
  if (!probe.repoRoot) return 'not-repo'
  if (!probe.remoteUrl.trim()) return 'no-remote'
  if (!probe.userName.trim() || !probe.userEmail.trim()) return 'identity'
  return 'ready'
}

/**
 * Kde stojí GitHub CLI. Odděleně od gitu, protože bez `gh` se dá commitovat
 * i pushovat -- jen se nesledují běhy a nezakládá PR.
 */
export type GhStep = 'not-github' | 'install' | 'login' | 'ready'

export function ghStep(probe: GitProbe | null, remote: GitRemote | null): GhStep {
  if (!isGitHub(remote)) return 'not-github'
  if (!probe || !probe.ghInstalled) return 'install'
  return parseGhAuth(probe.ghAuth)?.loggedIn ? 'ready' : 'login'
}

// -- změny --------------------------------------------------------------------

export type ChangeKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'

export interface ChangedFile {
  /** Cesta od kořene repa, s lomítky. Tak ji hlásí git a tak se mu vrací. */
  path: string
  kind: ChangeKind
  /** Původní cesta u přejmenování. */
  from?: string
}

function isMarkdown(path: string): boolean {
  return /\.(md|markdown)$/i.test(path)
}

function kindOf(xy: string): ChangeKind | null {
  if (xy === '??') return 'untracked'
  if (xy === '!!') return null
  if (xy.includes('U') || xy === 'AA' || xy === 'DD') return 'conflicted'
  if (xy.includes('R') || xy.includes('C')) return 'renamed'
  if (xy.includes('D')) return 'deleted'
  if (xy.includes('A')) return 'added'
  return 'modified'
}

function isUnder(path: string, folder: string): boolean {
  return folder === '' || path === folder || path.startsWith(`${folder}/`)
}

/**
 * Přečíst `git status --porcelain=v1 -z`.
 *
 * `-z` schválně: bez něj git jména s mezerou nebo diakritikou obalí uvozovkami
 * a escapuje, a přejmenování má tvar `staré -> nové`. S `-z` je každá položka
 * ukončená nulou a u přejmenování následuje původní cesta jako další položka.
 *
 * Vrací jen Markdown a jen to, co leží pod `under` (cesta otevřené složky od
 * kořene repa; prázdná = celé repo). Zbytek repa uživatele nezajímá a hlavně
 * ho nemá co commitovat.
 */
export function parseGitStatus(raw: string, under = ''): ChangedFile[] {
  const entries = raw.split('\0')
  const folder = under.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  const out: ChangedFile[] = []

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] ?? ''
    if (entry.length < 4 || entry[2] !== ' ') continue
    const xy = entry.slice(0, 2)
    const path = entry.slice(3)
    const kind = kindOf(xy)

    let from: string | undefined
    if (kind === 'renamed') {
      index += 1
      from = entries[index]
    }
    if (kind === null) continue
    if (!isMarkdown(path) && !(from && isMarkdown(from))) continue
    if (!isUnder(path, folder) && !(from && isUnder(from, folder))) continue

    out.push(from ? { path, kind, from } : { path, kind })
  }

  return out.sort((a, b) => a.path.localeCompare(b.path, 'cs'))
}

/** Konflikt se commitovat nemá; všechno ostatní ano. */
export function isCommittable(file: ChangedFile): boolean {
  return file.kind !== 'conflicted'
}

/**
 * Převést absolutní cestu souboru na cestu od kořene repa, jak ji zná git.
 *
 * Na Windows se porovnává bez ohledu na velikost písmen: `C:\Users` a
 * `c:\users` jsou tatáž složka a git ji hlásí, jak ji sám vidí.
 */
export function toRepoRelative(repoRoot: string, absolute: string): string | null {
  const root = repoRoot.replace(/\\/g, '/').replace(/\/+$/, '')
  const path = absolute.replace(/\\/g, '/')
  if (!root) return null
  const windows = /^[a-z]:\//i.test(root)
  const same = (a: string, b: string) => (windows ? a.toLowerCase() === b.toLowerCase() : a === b)

  if (same(path, root)) return ''
  if (!same(path.slice(0, root.length + 1), `${root}/`)) return null
  return path.slice(root.length + 1)
}

// -- návrhy -------------------------------------------------------------------

/** `docs/2026-09-19-1030` -- poznat na první pohled, odkud větev je a kdy vznikla. */
export function suggestBranch(now: Date): string {
  const two = (value: number) => String(value).padStart(2, '0')
  return `docs/${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}`
}

/** Zpráva commitu podle souborů. Uživatel ji vidí a může přepsat. */
export function suggestMessage(files: ChangedFile[]): string {
  const names = files.map((file) => file.path.split('/').pop() ?? file.path)
  if (names.length === 0) return ''
  if (names.length <= 3) return `Dokumentace: ${names.join(', ')}`
  const rest = names.length - 2
  const word = rest >= 5 ? 'dalších souborů' : 'další soubory'
  return `Dokumentace: ${names.slice(0, 2).join(', ')} a ${rest} ${word}`
}

/**
 * Smí se to jmenovat větev?
 *
 * Pravidla `git check-ref-format`, ta část, která se dá napsat bez gitu:
 * žádné mezery a řídicí znaky, žádné `~^:?*[\`, žádné `..` ani `@{`,
 * nezačíná pomlčkou ani lomítkem, nekončí lomítkem, tečkou ani `.lock`,
 * a žádná část mezi lomítky nezačíná tečkou.
 */
export function isValidBranchName(name: string): boolean {
  const text = name.trim()
  if (!text || text !== name) return false
  // eslint-disable-next-line no-control-regex
  if (/[\s~^:?*[\\\x00-\x1f\x7f]/.test(text)) return false
  if (text.includes('..') || text.includes('@{') || text.includes('//')) return false
  if (text.startsWith('-') || text.startsWith('/') || text.endsWith('/')) return false
  if (text.endsWith('.') || text.endsWith('.lock')) return false
  if (text === '@') return false
  return !text.split('/').some((part) => part === '' || part.startsWith('.') || part.endsWith('.lock'))
}

// -- běhy Actions -------------------------------------------------------------

/** Jeden stav pro semafor v UI, ať se `status` a `conclusion` neřeší třikrát. */
export type Outcome = 'queued' | 'running' | 'success' | 'failure' | 'cancelled' | 'skipped' | 'unknown'

export function outcome(status: string, conclusion: string | null): Outcome {
  if (status === 'completed') {
    switch (conclusion) {
      case 'success':
        return 'success'
      case 'failure':
      case 'timed_out':
      case 'startup_failure':
      case 'action_required':
        return 'failure'
      case 'cancelled':
        return 'cancelled'
      case 'skipped':
      case 'neutral':
        return 'skipped'
      default:
        return 'unknown'
    }
  }
  if (status === 'in_progress') return 'running'
  if (status === 'queued' || status === 'waiting' || status === 'pending' || status === 'requested') return 'queued'
  return 'unknown'
}

export interface WorkflowRun {
  id: number
  /** Jméno workflow, např. `ci`. */
  name: string
  status: string
  conclusion: string | null
  url: string
  branch: string
  sha: string
  event: string
  createdAt: string
  runNumber: number
}

export interface WorkflowStep {
  number: number
  name: string
  status: string
  conclusion: string | null
}

export interface WorkflowJob {
  id: number
  name: string
  status: string
  conclusion: string | null
  url: string
  steps: WorkflowStep[]
}

function parseList(json: string, key: string): Record<string, unknown>[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return []
  }
  if (!isRecord(parsed) || !Array.isArray(parsed[key])) return []
  return (parsed[key] as unknown[]).filter(isRecord)
}

/** `repos/{o}/{r}/actions/runs` -> seznam běhů. */
export function parseRuns(json: string): WorkflowRun[] {
  return parseList(json, 'workflow_runs').map((run) => ({
    id: num(run, 'id'),
    name: str(run, 'name'),
    status: str(run, 'status'),
    conclusion: typeof run.conclusion === 'string' ? run.conclusion : null,
    url: str(run, 'html_url'),
    branch: str(run, 'head_branch'),
    sha: str(run, 'head_sha'),
    event: str(run, 'event'),
    createdAt: str(run, 'created_at'),
    runNumber: num(run, 'run_number'),
  }))
}

/** `repos/{o}/{r}/actions/runs/{id}/jobs` -> úlohy s kroky. */
export function parseJobs(json: string): WorkflowJob[] {
  return parseList(json, 'jobs').map((job) => ({
    id: num(job, 'id'),
    name: str(job, 'name'),
    status: str(job, 'status'),
    conclusion: typeof job.conclusion === 'string' ? job.conclusion : null,
    url: str(job, 'html_url'),
    steps: (Array.isArray(job.steps) ? job.steps : []).filter(isRecord).map((step) => ({
      number: num(step, 'number'),
      name: str(step, 'name'),
      status: str(step, 'status'),
      conclusion: typeof step.conclusion === 'string' ? step.conclusion : null,
    })),
  }))
}

export interface Workflow {
  id: number
  name: string
  /** `active` | `disabled_manually` | `disabled_inactivity` */
  state: string
  path: string
}

/**
 * `repos/{o}/{r}/actions/workflows` -> co v repozitáři vůbec existuje.
 *
 * Odpovídá na otázku, kterou jinak nejde zodpovědět jinak než čekáním: má
 * smysl vyhlížet běh? Repozitář bez workflows žádný nespustí a workflow
 * spouštěné jen na tagy se po pushi do větve neozve.
 */
export function parseWorkflows(json: string): Workflow[] {
  return parseList(json, 'workflows').map((entry) => ({
    id: num(entry, 'id'),
    name: str(entry, 'name'),
    state: str(entry, 'state'),
    path: str(entry, 'path'),
  }))
}

export function activeWorkflows(workflows: Workflow[]): Workflow[] {
  return workflows.filter((workflow) => workflow.state === 'active')
}

// -- pull request -------------------------------------------------------------

/**
 * Název PR z jediného commitu.
 *
 * Když má commit víc řádků, bere se první -- to je shodou okolností přesně
 * konvence gitu i GitHubu.
 */
export function suggestPrTitle(commitMessage: string): string {
  return (commitMessage.split('\n')[0] ?? '').trim()
}

/** Zbytek zprávy commitu jako popis PR. Prázdný popis je v pořádku. */
export function suggestPrBody(commitMessage: string): string {
  return commitMessage.split('\n').slice(1).join('\n').trim()
}

/** Adresa hotového PR, tak jak ji vypíše `gh pr create`. */
export function isPrUrl(value: string): boolean {
  return /^https:\/\/[^\s]+\/pull\/\d+$/.test(value.trim())
}

/** Všechny běhy doběhly -- není na co čekat. */
export function runsSettled(runs: WorkflowRun[]): boolean {
  return runs.length > 0 && runs.every((run) => run.status === 'completed')
}

/** Souhrn přes všechny běhy: nejhorší vyhrává. */
export function overallOutcome(runs: WorkflowRun[]): Outcome {
  if (runs.length === 0) return 'unknown'
  const all = runs.map((run) => outcome(run.status, run.conclusion))
  if (all.includes('failure')) return 'failure'
  if (all.includes('running')) return 'running'
  if (all.includes('queued')) return 'queued'
  if (all.includes('cancelled')) return 'cancelled'
  if (all.every((one) => one === 'success' || one === 'skipped')) return 'success'
  return 'unknown'
}

// -- přihlášení ---------------------------------------------------------------

export const DEVICE_LOGIN_URL = 'https://github.com/login/device'

/**
 * Vytáhnout z výstupu `gh auth login --web` jednorázový kód.
 *
 * Řádek vypadá `! First copy your one-time code: D394-D2F5`. Uživatel ho opíše
 * do prohlížeče; Pilcrow ho jen ukáže, nikam ho neposílá.
 */
export function findDeviceCode(transcript: string): string | null {
  const code = /one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i.exec(transcript)?.[1]
  return code ? code.toUpperCase() : null
}

/** Řádky, které se ukážou jako průběh. `$ git …` je krok, zbytek jeho výstup. */
export function currentPublishStep(transcript: string): string | null {
  const lines = transcript.split('\n').filter((line) => line.startsWith('$ '))
  const last = lines[lines.length - 1]
  return last ? last.slice(2) : null
}
