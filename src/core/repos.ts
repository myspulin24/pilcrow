/**
 * Repozitáře na GitHubu -- čistá část.
 *
 * Doplněk k `git.ts`: tam je práce s *otevřenou* složkou, tady se teprve
 * vybírá, která to bude. Rust spustí `gh api` a `git clone`, rozumět tomu se
 * učí jen tohle místo.
 *
 * Dvě věci, které tenhle soubor hlídá a jinde by se na ně zapomnělo:
 *
 *  1. **Naklonováno se pozná podle remote, ne podle jména složky.** Složka
 *     `things-3` může být repo `Notes_MJ`. Porovnávat jména by znamenalo
 *     stáhnout podruhé něco, co už na disku je.
 *  2. **Bez práva zápisu se nedá pushovat.** Pozná se to z API předem, ne až
 *     když odeslání spadne na posledním kroku.
 */

import { parseRemote } from './git'

// -- repozitář ----------------------------------------------------------------

export interface Repo {
  /** `vlastnik/nazev`. */
  fullName: string
  owner: string
  name: string
  description: string
  language: string
  /** Velikost v kilobajtech, jak ji hlásí GitHub. */
  sizeKb: number
  defaultBranch: string
  updatedAt: string
  cloneUrl: string
  private: boolean
  fork: boolean
  archived: boolean
  /** Smí do něj přihlášený uživatel zapisovat? Bez toho push selže. */
  canPush: boolean
  /** Kde leží na disku, když už naklonovaný je. Doplňuje `matchClones`. */
  localPath?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value : ''
}

/**
 * Přečíst `gh api user/repos`.
 *
 * Je to tvar REST, ne ten, co vrací `gh repo list --json` -- `full_name`
 * místo `nameWithOwner`, `default_branch` místo `defaultBranchRef.name`.
 * Splést je znamená prázdný seznam bez jediné chyby, proto je to tady
 * na jednom místě a pokryté testem.
 *
 * `description` a `language` chodí jako `null`, ne jako chybějící pole.
 */
export function parseRepos(json: string): Repo[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const out: Repo[] = []
  for (const entry of parsed) {
    if (!isRecord(entry)) continue
    const fullName = str(entry, 'full_name')
    const [owner = '', name = ''] = fullName.split('/')
    if (!owner || !name) continue

    const permissions = isRecord(entry.permissions) ? entry.permissions : {}
    out.push({
      fullName,
      owner,
      name,
      description: str(entry, 'description'),
      language: str(entry, 'language'),
      sizeKb: typeof entry.size === 'number' && Number.isFinite(entry.size) ? entry.size : 0,
      defaultBranch: str(entry, 'default_branch'),
      updatedAt: str(entry, 'updated_at'),
      cloneUrl: str(entry, 'clone_url'),
      private: entry.private === true,
      fork: entry.fork === true,
      archived: entry.archived === true,
      canPush: permissions.push === true,
    })
  }
  return out
}

// -- co už je na disku --------------------------------------------------------

export interface LocalClone {
  /** Absolutní cesta ke složce. */
  path: string
  /** Adresa `origin`. Prázdná, když repo remote nemá. */
  remote: string
}

export function parseClones(json: string): LocalClone[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter(isRecord)
    .map((entry) => ({ path: str(entry, 'path'), remote: str(entry, 'remote') }))
    .filter((clone) => clone.path !== '')
}

/** Klíč pro porovnání dvou adres téhož repozitáře. */
function remoteKey(url: string): string | null {
  const remote = parseRemote(url)
  if (!remote) return null
  return `${remote.host}/${remote.owner.toLowerCase()}/${remote.repo.toLowerCase()}`
}

/**
 * Doplnit k repozitářům, kde na disku leží.
 *
 * Porovnává se remote, ne jméno složky: `things-3` může být `Notes_MJ`.
 * Když je totéž repo naklonované dvakrát, vyhrává první nalezené -- seřazené
 * jsou podle jména, takže výsledek nezávisí na pořadí ze souborového systému.
 */
export function matchClones(repos: Repo[], clones: LocalClone[]): Repo[] {
  const byRemote = new Map<string, string>()
  for (const clone of [...clones].sort((a, b) => a.path.localeCompare(b.path, 'cs'))) {
    const key = remoteKey(clone.remote)
    if (key && !byRemote.has(key)) byRemote.set(key, clone.path)
  }
  return repos.map((repo) => {
    const key = remoteKey(repo.cloneUrl)
    const localPath = key ? byRemote.get(key) : undefined
    return localPath ? { ...repo, localPath } : repo
  })
}

/** Jméno složky, do které se repo stáhne. */
export function cloneFolderName(repo: Repo): string {
  const safe = repo.name.replace(/[\\/:*?"<>|]/g, '-').replace(/^\.+/, '').trim()
  return safe || 'repozitar'
}

// -- hledání a řazení ---------------------------------------------------------

/** Hledá v jméně, vlastníkovi, popisu i jazyce. Bez diakritiky a velikosti písmen. */
export function filterRepos(repos: Repo[], query: string): Repo[] {
  const needle = normalise(query)
  if (!needle) return repos
  return repos.filter((repo) =>
    normalise(`${repo.fullName} ${repo.description} ${repo.language}`).includes(needle),
  )
}

function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
}

/**
 * Naklonované nahoru, zbytek podle poslední změny.
 *
 * To, co už na disku je, chce uživatel skoro vždycky spíš otevřít než hledat
 * mezi dvaceti dalšími.
 */
export function sortRepos(repos: Repo[]): Repo[] {
  return [...repos].sort((a, b) => {
    if (!!a.localPath !== !!b.localPath) return a.localPath ? -1 : 1
    return b.updatedAt.localeCompare(a.updatedAt)
  })
}

// -- popisky ------------------------------------------------------------------

/** Velikost repa lidsky. GitHub ji hlásí v kilobajtech. */
export function formatRepoSize(sizeKb: number): string {
  if (sizeKb <= 0) return ''
  if (sizeKb < 1024) return `${Math.max(1, Math.round(sizeKb))} kB`
  const mb = sizeKb / 1024
  if (mb < 100) return `${mb.toFixed(1).replace('.', ',')} MB`
  return `${Math.round(mb)} MB`
}

// -- průběh klonování ---------------------------------------------------------

export type ClonePhase = 'start' | 'counting' | 'compressing' | 'receiving' | 'resolving' | 'files' | 'done'

export interface CloneProgress {
  phase: ClonePhase
  /** 0-100, nebo `null`, když fáze procenta nehlásí. */
  percent: number | null
}

/**
 * Vytáhnout z výstupu `git clone --progress`, kde se to nachází.
 *
 * Git průběh odděluje návratem vozíku, ne novým řádkem: celé „Receiving
 * objects“ je *jeden* řádek s desítkami `\r`. Kdyby se dělilo jen podle `\n`,
 * panel by ukázal jeden nekonečný řádek. Bere se poslední úsek, protože jen
 * ten platí teď.
 */
export function cloneProgress(transcript: string): CloneProgress | null {
  const pieces = transcript.split(/[\r\n]+/).filter((piece) => piece.trim())
  const last = pieces[pieces.length - 1]
  if (!last) return null

  const percent = (() => {
    const match = /(\d{1,3})%/.exec(last)
    if (!match?.[1]) return null
    return Math.min(100, Number(match[1]))
  })()

  const phase: ClonePhase = /Updating files|Checking out/i.test(last)
    ? 'files'
    : /Resolving deltas/i.test(last)
      ? 'resolving'
      : /Receiving objects/i.test(last)
        ? 'receiving'
        : /Compressing objects/i.test(last)
          ? 'compressing'
          : /Counting objects|Enumerating objects/i.test(last)
            ? 'counting'
            : 'start'

  return { phase, percent }
}
