/**
 * Hranice gitu a GitHub CLI.
 *
 * Stejný vzor jako `VaultApi` a `AssistantApi`: jedno rozhraní, dvě skutečné
 * implementace.
 *
 *   - `TauriGit`  - opravdová: spustí na tvém počítači `git` a `gh`.
 *   - `MemoryGit` - stejná sémantika bez procesů, pro `npm run dev:web`
 *     a pro testy. Vrací výstup ve stejném tvaru jako skutečné nástroje
 *     (`git status -z`, JSON z `gh api`), takže testy procházejí stejnými
 *     parsery jako aplikace.
 *
 * Co odchází z počítače: commit a push na *tvůj* remote, a čtení běhů Actions
 * z GitHubu. Nic víc. Běhy se nikdy nespouštějí a workflow se nemění.
 */

import type { GhProbe, GitProbe, MergeMethod } from '@/core'

/** Kus výstupu z běžícího procesu, tak jak přišel. */
export type GitChunk =
  | { kind: 'out'; text: string }
  | { kind: 'finished' }
  | { kind: 'failed'; message: string }

export type GitSink = (chunk: GitChunk) => void

export interface PublishInput {
  /** Otevřená složka -- ta, ke které je udělený přístup. */
  folder: string
  /** Cesty od kořene repa, s lomítky, tak jak je hlásí `git status`. */
  files: string[]
  message: string
  branch: string
}

export interface GitApi {
  /** `false` v prohlížeči: procesy jdou spouštět jen z desktopové aplikace. */
  readonly available: boolean

  /** Jak často se ptát GitHubu na běh. Testy to stáhnou na pár desítek ms. */
  readonly pollMs: number

  /** Co je na počítači a v jakém repu složka leží. */
  probe(folder: string): Promise<GitProbe>

  /** Surový `git status --porcelain=v1 -z` omezený na složku. Čte ho `parseGitStatus`. */
  status(folder: string): Promise<string>

  /** Nová větev, add, commit, push. Průběh chodí do `sink`. */
  publish(input: PublishInput, sink: GitSink): Promise<void>

  /** Jen push -- když ten první selhal a commit už je. */
  push(folder: string, branch: string, sink: GitSink): Promise<void>

  /** Zastavit rozběhnuté odeslání. */
  cancel(): Promise<void>

  /** Surový JSON běhů pro daný commit. Čte ho `parseRuns`. */
  runs(folder: string, headSha: string): Promise<string>

  /** Surový JSON úloh a kroků jednoho běhu. Čte ho `parseJobs`. */
  jobs(folder: string, runId: number): Promise<string>

  /** Posledních pár běhů v repu. */
  recentRuns(folder: string): Promise<string>

  /**
   * Co v repozitáři vůbec za workflows je. Čte to `parseWorkflows`.
   *
   * Bez tohohle se nedá poznat rozdíl mezi „běh se ještě neobjevil“
   * a „nikdy se neobjeví, protože tu žádný workflow není“.
   */
  workflows(folder: string): Promise<string>

  /** Založit pull request. Vrací adresu hotového PR. */
  createPr(input: CreatePrInput): Promise<string>

  /**
   * Zjistit stav proti remote: `git fetch` a spočítat rozdíl.
   *
   * Surový JSON; čte ho `parseSyncState`. Fetch sahá na síť, takže se to
   * volá při otevření repozitáře a na vyžádání, ne při každém překreslení.
   */
  syncState(folder: string): Promise<string>

  /** Stáhnout, co na remote přibylo. Jen převinutí; průběh chodí do `sink`. */
  pull(folder: string, sink: GitSink): Promise<void>

  /** Otevřený PR pro danou větev. Surový JSON; čte ho `parsePullRequest`. */
  pullRequest(folder: string, branch: string): Promise<string>

  /** Co repozitář povoluje za způsoby sloučení. Čte `parseMergeMethods`. */
  mergeMethods(folder: string): Promise<string>

  /**
   * Sloučit pull request a uklidit po něm: přepnout na cílovou větev,
   * stáhnout ji a smazat tu sloučenou. Průběh chodí do `sink`.
   *
   * Sloučení je nevratné a děje se na GitHubu -- volá se jen po potvrzení.
   */
  mergePr(input: MergePrInput, sink: GitSink): Promise<void>

  /**
   * Přihlásit GitHub CLI přes prohlížeč.
   *
   * Do `sink` přijde jednorázový kód, který uživatel opíše na github.com.
   * Pilcrow ho jen ukáže; token si `gh` uloží do klíčenky sám.
   */
  login(sink: GitSink): Promise<void>
  loginCancel(): Promise<void>

  /** Otevřít adresu v prohlížeči. Jen https; hlídá to Rust. */
  openUrl(url: string): Promise<void>

  // --- výběr repozitáře ----------------------------------------------------
  //
  // Tahle čtveřice běží dřív, než je co otevřít, takže se neptá na složku --
  // až na `clones` a `clone`, které pracují s tou, kam se stahuje.

  /** Stav GitHub CLI bez ohledu na složku. Čte ho `ghProbeStep`. */
  ghStatus(): Promise<GhProbe>

  /** Surový JSON repozitářů z `gh api user/repos`. Čte ho `parseRepos`. */
  repos(): Promise<string>

  /** Co ve složce s repozitáři už leží: cesty a jejich `origin`. Čte `parseClones`. */
  clones(folder: string): Promise<string>

  /**
   * Stáhnout repozitář. Vrací cílovou cestu hned, průběh chodí do `sink`.
   *
   * Existující složku nikdy nepřepíše -- to je chyba, ne přepis.
   */
  clone(input: CloneInput, sink: GitSink): Promise<string>
}

export interface CreatePrInput {
  folder: string
  /** Do které větve se sloučí. */
  base: string
  /** Která větev se slučuje. */
  head: string
  title: string
  body: string
}

export interface MergePrInput {
  folder: string
  number: number
  method: MergeMethod
  base: string
  head: string
  /** Smazat sloučenou větev lokálně i na GitHubu. */
  deleteBranch: boolean
}

export interface CloneInput {
  /** `vlastnik/nazev`. */
  repo: string
  /** Složka, do které se stahuje. */
  parent: string
  /** Jméno podsložky, která vznikne. */
  folder: string
}

/** Vytáhnout z čehokoli chybovou větu, kterou jde ukázat člověku. */
export function gitMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) return error
  if (error instanceof Error && error.message) return error.message
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string' &&
    (error as { message: string }).message.trim()
  ) {
    return (error as { message: string }).message
  }
  return fallback
}
