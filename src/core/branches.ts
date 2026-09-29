/**
 * Větve, porovnání s výchozí větví a napojení složky -- čistá část.
 *
 * Doplněk k `git.ts`: tam je práce s tím, co je rozdělané v otevřené složce,
 * tady pohled do ostatních větví a na to, čím se složka liší od main. Rust
 * spustí `for-each-ref`, `log` a `diff` a pošle, co vypsaly; rozumět tomu se
 * učí jen tohle místo.
 *
 * Tři věci, které tenhle soubor hlídá:
 *
 *  1. **Větev je jedna, i když je na dvou místech.** `main` doma
 *     a `origin/main` na GitHubu je pro člověka tatáž větev, jen může být
 *     napřed nebo pozadu. Seznam je proto podle jména, ne podle reference.
 *  2. **Stahuje se jen to, co si uživatel vybral.** Rozhodnutí, co se nabídne
 *     za kroky, je tady (`compareSteps`); samo se nestane nic.
 *  3. **Složka se napojí jen na svůj vlastní repozitář.** Cizí repo, nebo
 *     složka uvnitř cizího repa, se odmítne dřív, než se na disku cokoli
 *     změní (`inspectionKind`).
 */

import type { GitRemote } from './git'
import { sameRemote } from './repos'
import { t } from './messages'

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

function parseObject(json: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(json)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function isMarkdown(path: string): boolean {
  return /\.(md|markdown)$/i.test(path)
}

// -- větve --------------------------------------------------------------------

export interface Branch {
  /** Jméno bez `origin/`, třeba `docs/2026-09-22-1710`. */
  name: string
  /** Je doma (`refs/heads`). */
  local: boolean
  /** Je na GitHubu (`refs/remotes/origin`). */
  remote: boolean
  /** Na téhle se právě stojí. */
  current: boolean
  /** Výchozí větev repozitáře, typicky `main`. */
  isDefault: boolean
  /** Krátké SHA posledního commitu -- toho novějšího z obou míst. */
  sha: string
  /** Kdy vznikl poslední commit, ISO 8601. */
  date: string
  author: string
  /** První řádek zprávy posledního commitu. */
  subject: string
  /** Kolik commitů má větev doma navíc proti GitHubu. */
  ahead: number
  /** Kolik commitů má GitHub navíc proti domácí větvi. */
  behind: number
  /** Doma větev sledovala GitHub, ale tam už není -- nejspíš ji smazal merge. */
  gone: boolean
}

export interface BranchList {
  /** Na které větvi se stojí. `HEAD`, když na žádné. */
  current: string
  defaultBranch: string
  /** Proč se nepodařilo zeptat GitHubu. Seznam je pak z minula. */
  fetchError: string
  branches: Branch[]
}

/**
 * `ahead 1, behind 2` z `%(upstream:track,nobracket)`.
 *
 * Prázdné = shodné, nebo žádná sledovaná větev. `gone` = na GitHubu už není.
 */
export function parseTrack(track: string): { ahead: number; behind: number; gone: boolean } {
  const text = track.trim()
  if (text === 'gone') return { ahead: 0, behind: 0, gone: true }
  const ahead = Number(/ahead (\d+)/.exec(text)?.[1] ?? 0)
  const behind = Number(/behind (\d+)/.exec(text)?.[1] ?? 0)
  return { ahead, behind, gone: false }
}

interface RefLine {
  refname: string
  sha: string
  date: string
  author: string
  upstream: string
  track: string
  subject: string
}

function parseRefLines(raw: string): RefLine[] {
  return raw
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.includes('\0'))
    .map((line) => {
      const [refname = '', sha = '', date = '', author = '', upstream = '', track = '', ...rest] = line.split('\0')
      // Předmět je poslední a může v něm být cokoli -- kromě nuly, kterou by
      // git do jednoho řádku stejně nedal. Pro jistotu se zbytek slepí.
      return { refname, sha, date, author, upstream, track, subject: rest.join('\0') }
    })
}

const HEADS = 'refs/heads/'
const REMOTES = 'refs/remotes/origin/'

/**
 * Přečíst `git_branches`: `{ current, default, fetchError, refs }`.
 *
 * `refs` je surový `for-each-ref` přes `refs/heads` i `refs/remotes/origin`,
 * jeden řádek na referenci, pole oddělená nulou. Domácí a vzdálená větev
 * téhož jména se slijí do jedné položky.
 *
 * Pořadí: aktuální, výchozí, pak podle posledního commitu. Tak, jak se
 * v nich hledá -- kde jsem, odkud se vychází, co se hýbalo naposled.
 */
export function parseBranches(json: string): BranchList {
  const parsed = parseObject(json)
  if (!parsed) return { current: '', defaultBranch: '', fetchError: '', branches: [] }
  const current = str(parsed, 'current')
  const defaultBranch = str(parsed, 'default')

  const byName = new Map<string, { local?: RefLine; remote?: RefLine }>()
  for (const line of parseRefLines(str(parsed, 'refs'))) {
    let name: string
    let side: 'local' | 'remote'
    if (line.refname.startsWith(HEADS)) {
      name = line.refname.slice(HEADS.length)
      side = 'local'
    } else if (line.refname.startsWith(REMOTES)) {
      name = line.refname.slice(REMOTES.length)
      side = 'remote'
      // `origin/HEAD` je ukazatel na výchozí větev, ne větev.
      if (name === 'HEAD') continue
    } else {
      continue
    }
    if (!name) continue
    byName.set(name, { ...byName.get(name), [side]: line })
  }

  const branches: Branch[] = [...byName.entries()].map(([name, { local, remote }]) => {
    // Informace o posledním commitu z novějšího z obou míst: doma může být
    // neodeslaný commit, na GitHubu může být cizí, který se ještě nestáhl.
    const newest =
      local && remote ? (Date.parse(remote.date) > Date.parse(local.date) ? remote : local) : (local ?? remote)!
    const track = local ? parseTrack(local.track) : { ahead: 0, behind: 0, gone: false }
    return {
      name,
      local: !!local,
      remote: !!remote,
      current: name === current,
      isDefault: name === defaultBranch,
      sha: newest.sha,
      date: newest.date,
      author: newest.author,
      subject: newest.subject,
      ahead: track.ahead,
      behind: track.behind,
      gone: track.gone,
    }
  })

  branches.sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
    const byDate = (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0)
    return byDate !== 0 ? byDate : a.name.localeCompare(b.name, 'cs')
  })

  return { current, defaultBranch, fetchError: str(parsed, 'fetchError'), branches }
}

function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
}

/** Hledá ve jméně, autorovi i posledním commitu. Bez diakritiky a velikosti písmen. */
export function filterBranches(branches: Branch[], query: string): Branch[] {
  const needle = normalise(query)
  if (!needle) return branches
  return branches.filter((branch) => normalise(`${branch.name} ${branch.author} ${branch.subject}`).includes(needle))
}

/**
 * Reference, podle které se na větev dívat: ta na GitHubu, když tam je.
 *
 * Prohlížeč větví odpovídá na otázku „co je na GitHubu“; domácí kopie může
 * být týden stará. Větev, která je jen doma, se ukáže taková, jaká doma je.
 */
export function branchRef(branch: Branch): string {
  return branch.remote ? `origin/${branch.name}` : branch.name
}

/** Stránka větve na GitHubu. Jen u větví, které tam jsou. */
export function branchUrl(remote: GitRemote, branch: string): string {
  const seg = branch.split('/').map(encodeURIComponent).join('/')
  return `https://${remote.host}/${remote.owner}/${remote.repo}/tree/${seg}`
}

/** Co se s větví stane, když se vybere „Stáhnout a otevřít“. */
export type SwitchKind = 'current' | 'pull' | 'switch' | 'download'

export function switchKind(branch: Branch): SwitchKind {
  if (branch.current) return branch.behind > 0 ? 'pull' : 'current'
  return branch.local ? 'switch' : 'download'
}

// -- co větev přinesla --------------------------------------------------------

export interface Commit {
  sha: string
  author: string
  date: string
  subject: string
}

/** Jak se soubor liší. `local` = je jen tady, v gitu ho nic nesleduje. */
export type FileChangeKind = 'modified' | 'added' | 'deleted' | 'local'

export interface FileChange {
  /** Cesta od kořene repa, s lomítky. */
  path: string
  kind: FileChangeKind
  /** Přidané a smazané řádky. `null` u binárních souborů a u nových bez historie. */
  additions: number | null
  deletions: number | null
}

/** `git log --format=%h%x00%an%x00%cI%x00%s` -> commity. */
export function parseLog(raw: string): Commit[] {
  return raw
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.includes('\0'))
    .map((line) => {
      const [sha = '', author = '', date = '', ...rest] = line.split('\0')
      return { sha, author, date, subject: rest.join('\0') }
    })
}

/**
 * `git diff --name-status -z --no-renames`: stav a cesta, obojí zakončené nulou.
 *
 * Bez `--no-renames` by přejmenování mělo tři pole místo dvou a všechno za
 * ním by se posunulo. Rust ho posílá vždycky.
 */
function parseNameStatus(raw: string): Array<{ status: string; path: string }> {
  const tokens = raw.split('\0')
  const out: Array<{ status: string; path: string }> = []
  for (let index = 0; index + 1 < tokens.length; index += 2) {
    const status = (tokens[index] ?? '').trim()
    const path = tokens[index + 1] ?? ''
    if (status && path) out.push({ status, path })
  }
  return out
}

/** `git diff --numstat -z --no-renames`: `přidáno<TAB>smazáno<TAB>cesta<NUL>`; binární mají `-`. */
function parseNumstat(raw: string): Map<string, { additions: number | null; deletions: number | null }> {
  const out = new Map<string, { additions: number | null; deletions: number | null }>()
  for (const entry of raw.split('\0')) {
    const match = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(entry)
    if (!match) continue
    const [, added = '-', deleted = '-', path = ''] = match
    out.set(path, {
      additions: added === '-' ? null : Number(added),
      deletions: deleted === '-' ? null : Number(deleted),
    })
  }
  return out
}

function kindOfStatus(status: string): FileChangeKind {
  if (status.startsWith('A')) return 'added'
  if (status.startsWith('D')) return 'deleted'
  return 'modified'
}

/**
 * Seznam rozdílných souborů: jen Markdown, a kolik je ostatních.
 *
 * Pilcrow pracuje s dokumentací; změněný zdroják v repu se nezamlčí, ale
 * nevypisuje se jménem -- stejně jako v seznamu změn.
 */
export function fileChanges(
  nameStatus: string,
  numstat: string,
  untracked = '',
): { files: FileChange[]; others: number } {
  const counts = parseNumstat(numstat)
  const files: FileChange[] = []
  let others = 0

  const add = (path: string, kind: FileChangeKind) => {
    if (!isMarkdown(path)) {
      others += 1
      return
    }
    const count = counts.get(path)
    files.push({ path, kind, additions: count?.additions ?? null, deletions: count?.deletions ?? null })
  }

  for (const { status, path } of parseNameStatus(nameStatus)) add(path, kindOfStatus(status))
  for (const path of untracked.split('\0').filter(Boolean)) add(path, 'local')

  files.sort((a, b) => a.path.localeCompare(b.path, 'cs'))
  return { files, others }
}

export interface BranchReport {
  /** Kolik commitů má větev navíc proti základu. */
  ahead: number
  /** Kolik commitů jí chybí, co mezitím přibylo v základu. */
  behind: number
  commits: Commit[]
  files: FileChange[]
  /** Kolik změněných souborů není Markdown. */
  others: number
}

/** Přečíst `git_branch_log`. */
export function parseBranchReport(json: string): BranchReport {
  const parsed = parseObject(json)
  if (!parsed) return { ahead: 0, behind: 0, commits: [], files: [], others: 0 }
  const { files, others } = fileChanges(str(parsed, 'nameStatus'), str(parsed, 'numstat'))
  return {
    ahead: num(parsed, 'ahead'),
    behind: num(parsed, 'behind'),
    commits: parseLog(str(parsed, 'log')),
    files,
    others,
  }
}

// -- porovnání s výchozí větví ------------------------------------------------

export interface Compare {
  /** Proti čemu se porovnávalo, třeba `origin/main`. */
  base: string
  /** Na které větvi se stojí. */
  branch: string
  /** Commity, které má složka navíc proti základu. */
  ahead: number
  /** Commity, které má základ navíc -- co se dá stáhnout. */
  behind: number
  files: FileChange[]
  others: number
  fetchError: string
}

/** Přečíst `git_compare`. */
export function parseCompare(json: string): Compare | null {
  const parsed = parseObject(json)
  if (!parsed) return null
  const { files, others } = fileChanges(str(parsed, 'nameStatus'), str(parsed, 'numstat'), str(parsed, 'untracked'))
  return {
    base: str(parsed, 'base'),
    branch: str(parsed, 'branch'),
    ahead: num(parsed, 'ahead'),
    behind: num(parsed, 'behind'),
    files,
    others,
    fetchError: str(parsed, 'fetchError'),
  }
}

/**
 * Co se s rozdílem proti main dá dělat.
 *
 *  - `identical` -- nic se neliší, není co dělat.
 *  - `publish`   -- jsou rozdělané změny, dají se odeslat (na větev pro PR,
 *                   nebo rovnou do main).
 *  - `restore`   -- soubory, které v main jsou, se dají vrátit na jejich
 *                   podobu z main. Jen když se stojí na výchozí větvi: na
 *                   jiné by to potichu vracelo práci té větve.
 *  - `pull`      -- main má něco navíc, dá se stáhnout.
 *  - `ahead`     -- složka má commity, které v main nejsou; ty se slučují
 *                   přes pull request, ne tady.
 *
 * Pořadí je pořadí, ve kterém je uživatel uvidí.
 */
export type CompareStep = 'identical' | 'publish' | 'restore' | 'pull' | 'ahead'

export function compareSteps(compare: Compare, pending: number, defaultBranch: string): CompareStep[] {
  if (compare.files.length === 0 && compare.others === 0 && compare.ahead === 0 && compare.behind === 0 && pending === 0) {
    return ['identical']
  }
  const steps: CompareStep[] = []
  if (pending > 0) steps.push('publish')
  // Vracet jde jen tam, kde se stojí přesně na main z GitHubu. Když je
  // složka pozadu, v seznamu jsou i soubory, které změnil jen GitHub -- a
  // „vrátit“ by z nich udělalo napůl stažené změny; když je napřed, vracelo
  // by to potichu vlastní commity. Tam napřed stáhnout, nebo slučovat přes PR.
  if (
    compare.branch === defaultBranch &&
    compare.ahead === 0 &&
    compare.behind === 0 &&
    restorable(compare).length > 0
  ) {
    steps.push('restore')
  }
  if (compare.behind > 0) steps.push('pull')
  if (compare.ahead > 0) steps.push('ahead')
  return steps.length > 0 ? steps : ['identical']
}

/** Soubory, které jde vrátit na podobu ze základu -- tedy ty, které v něm jsou. */
export function restorable(compare: Compare): FileChange[] {
  return compare.files.filter((file) => file.kind === 'modified' || file.kind === 'deleted')
}

// -- napojení složky ----------------------------------------------------------

export interface FolderInspection {
  /** Kořen repozitáře, ve kterém složka leží. Prázdné = v žádném. */
  root: string
  /** `origin` toho repozitáře. */
  remote: string
  /** Složka je sama kořenem, ne podsložkou. */
  isRoot: boolean
  markdownFiles: number
}

export function parseFolderInspection(json: string): FolderInspection | null {
  const parsed = parseObject(json)
  if (!parsed) return null
  return {
    root: str(parsed, 'root'),
    remote: str(parsed, 'remote'),
    isRoot: parsed.isRoot === true,
    markdownFiles: num(parsed, 'markdownFiles'),
  }
}

/**
 * Co vybraná složka je vzhledem k repozitáři, na který se má napojit.
 *
 *  - `plain`  -- obyčejná složka. Dá se z ní udělat pracovní kopie.
 *  - `same`   -- už je to kopie téhož repozitáře (nebo její podsložka). Není
 *                co zakládat, jen se začne používat.
 *  - `other`  -- je to kopie *jiného* repozitáře. Napojit ji nejde: měla by
 *                pak dva remoty a nikdo by nevěděl, kam se co odesílá.
 *  - `inside` -- leží uvnitř jiného repozitáře. Založit v ní vlastní by
 *                udělalo repo v repu.
 *
 * Porovnává se remote, ne jméno složky -- stejná úmluva jako u `matchClones`.
 */
export type InspectionKind = 'plain' | 'same' | 'other' | 'inside'

export function inspectionKind(inspection: FolderInspection, cloneUrl: string): InspectionKind {
  if (!inspection.root) return 'plain'
  if (sameRemote(inspection.remote, cloneUrl)) return 'same'
  return inspection.isRoot ? 'other' : 'inside'
}

// -- kam odeslat --------------------------------------------------------------

/** Nová větev pro pull request, nebo commit na větev, která už je. */
export type PublishMode = 'new' | 'existing'

/**
 * Větve, na které se dá odeslat „do existující“: ty, co jsou na GitHubu,
 * a ta, na které se stojí. Výchozí větev ne -- ta má v dialogu vlastní
 * volbu s varováním, protože se do ní zapisuje bez pull requestu.
 */
export function existingTargets(list: BranchList, defaultBranch = list.defaultBranch): Branch[] {
  // Výchozí se pozná i podle jména: když ji klon nezná (`origin/HEAD`
  // chybí), nesmí se sem propašovat bez varování, které má její volba.
  return list.branches.filter(
    (branch) =>
      !branch.isDefault &&
      branch.name !== defaultBranch &&
      branch.name !== 'HEAD' &&
      !branch.gone &&
      (branch.remote || branch.current),
  )
}

// -- výpis rozdílu ------------------------------------------------------------

export type PatchLineKind = 'meta' | 'hunk' | 'add' | 'del' | 'context' | 'note'

export interface PatchLine {
  kind: PatchLineKind
  text: string
}

/**
 * Rozdělit výstup `git diff` na řádky podle toho, co znamenají.
 *
 * Hlavička (`diff --git`, `index`, `---`, `+++`) je `meta` -- okno ji
 * neukazuje, jméno souboru je nad výpisem. `\ No newline at end of file`
 * je `note`.
 */
export function patchLines(text: string): PatchLine[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  let inHeader = true
  return lines.map((line) => {
    if (line.startsWith('diff --git ')) {
      inHeader = true
      return { kind: 'meta', text: line }
    }
    if (line.startsWith('@@')) {
      inHeader = false
      return { kind: 'hunk', text: line }
    }
    if (inHeader) return { kind: 'meta', text: line }
    if (line.startsWith('\\')) return { kind: 'note', text: line }
    if (line.startsWith('+')) return { kind: 'add', text: line }
    if (line.startsWith('-')) return { kind: 'del', text: line }
    return { kind: 'context', text: line }
  })
}

// -- popisky ------------------------------------------------------------------

/**
 * Kdy naposledy, lidsky: „před 3 dny“, a u starších datum.
 *
 * `now` se předává, ať se to dá otestovat bez hodin.
 */
export function relativeTime(iso: string, now: number): string {
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return ''
  const minutes = Math.floor((now - at) / 60_000)
  if (minutes < 1) return t.notes.justNow
  if (minutes < 60) return t.notes.minutesAgo(minutes)
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t.notes.hoursAgo(hours)
  const days = Math.floor(hours / 24)
  if (days < 30) return t.notes.daysAgo(days)
  const date = new Date(at)
  return `${date.getDate()}. ${date.getMonth() + 1}. ${date.getFullYear()}`
}
