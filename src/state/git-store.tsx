/**
 * Stav gitu nad otevřenou složkou.
 *
 * Bydlí vedle hlavního storu ze stejného důvodu jako asistent: s poznámkami
 * sdílí jen dvě věci -- kterou složku má průzkumník otevřenou a které soubory
 * v ní Pilcrow zapsal -- a nese si vlastní životní cyklus: zjistit stav,
 * ukázat změny, odeslat, sledovat běh.
 *
 * Dvě pravidla, která se tu vynucují:
 *
 *  1. Do commitu jde jen to, co je zaškrtnuté. Předvybrané je, co zapsal
 *     Pilcrow; co uživatel odškrtl, se znovu nezaškrtne samo.
 *  2. Sleduje se běh pro *náš* commit -- podle SHA, ne „poslední v repu“.
 *     A běh se po pushi objeví až za chvíli, takže „ještě tam není“ je
 *     stav, ne chyba.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import {
  actionsUrl,
  activeFolder,
  activeWorkflows,
  canFastForward,
  compareUrl,
  currentPublishStep,
  findDeviceCode,
  ghStep,
  gitStep,
  isCommittable,
  parseGhAuth,
  parseGitStatus,
  parseJobs,
  parseMergeMethods,
  parsePullRequest,
  parseRemote,
  parseRuns,
  parseSyncState,
  parseWorkflows,
  runsSettled,
  t,
  toRepoRelative,
  type ChangedFile,
  type GhAccount,
  type GhStep,
  type GitProbe,
  type GitRemote,
  type GitStep,
  type MergeMethod,
  type MergeMethods,
  type PullRequest,
  type SyncState,
  type Workflow,
  type WorkflowJob,
  type WorkflowRun,
} from '@/core'
import { createGit, gitMessage, type GitApi, type GitChunk } from '@/git'

import { useStore } from './store'

/** Co zrovna běží. Nikdy dvě věci naráz. */
export type GitBusy = 'probe' | 'status' | 'login' | 'publish' | 'push' | 'pr' | 'merge' | 'pull' | null

/** Kde je sledování běhu. */
export type Watching = 'idle' | 'waiting' | 'running' | 'done' | 'timeout' | 'none'

export interface Published {
  branch: string
  /** Větev, ze které se vyšlo -- základ pro PR. */
  base: string
  sha: string
  pushed: boolean
  /** Push selhal, ale commit je: dá se zkusit znovu. */
  retryable: boolean
}

export interface GitView {
  /** Složka, ke které se všechno vztahuje. */
  folder: string | null
  probed: boolean
  probe: GitProbe | null
  step: GitStep
  gh: GhStep
  account: GhAccount | null
  remote: GitRemote | null
  busy: GitBusy
  changes: ChangedFile[]
  /** Cesty od kořene repa zaškrtnuté do commitu. */
  selected: string[]
  /** Cesty od kořene repa, které zapsal Pilcrow. */
  touched: string[]
  /** Cesta otevřené složky od kořene repa; prázdná = složka je kořen. */
  under: string
  transcript: string
  error: string | null
  publishOpen: boolean
  published: Published | null
  runs: WorkflowRun[]
  jobs: Record<number, WorkflowJob[]>
  watching: Watching
  /** Co v repozitáři za workflows je. Prázdné pole = žádný běh nepřijde. */
  workflows: Workflow[]
  /** Dialog založení pull requestu. */
  prOpen: boolean
  /** Adresa hotového PR, jakmile vznikne. */
  prUrl: string | null
  /** Zpráva posledního commitu -- předvyplní název a popis PR. */
  lastMessage: string
  /** Proč se PR nepodařilo založit nebo sloučit. Ukazuje se v dialogu. */
  prError: string | null
  /** Otevřený PR pro odeslanou větev. Hledá se podle větve, ne podle čísla. */
  pr: PullRequest | null
  /** Co repozitář povoluje za způsoby sloučení. */
  mergeMethods: MergeMethods
  /** Dialog sloučení. */
  mergeOpen: boolean
  /** PR se povedlo sloučit. */
  mergedNumber: number | null
  /** Jak je složka na tom proti remote. `null` = ještě se neptalo. */
  sync: SyncState | null
  /** Stáhlo se samo při otevření. Ukáže se jednou, pak zmizí. */
  pulled: boolean
  /** `null` = zatím nenačteno. */
  recent: WorkflowRun[] | null
  recentError: string | null
  deviceCode: string | null
  /**
   * Kdy naposledy doběhlo zjišťování stavu. `null` = ještě nikdy.
   *
   * Ukazuje se v hlavičce sekce. Bez toho nešlo poznat, jestli tlačítko
   * „Zkontrolovat znovu“ něco udělalo: u složky, kde se nic nezměnilo,
   * vypadá hotové zjištění stejně jako žádné.
   */
  checkedAt: number | null
}

export interface GitActions {
  refresh(): Promise<void>
  refreshChanges(): Promise<void>
  toggleFile(path: string): void
  selectAll(): void
  selectNone(): void
  openPublish(): void
  closePublish(): void
  publish(message: string, branch: string): Promise<void>
  retryPush(): Promise<void>
  cancel(): Promise<void>
  dismissPublished(): void
  login(): Promise<void>
  cancelLogin(): Promise<void>
  openCompare(): Promise<void>
  openActions(): Promise<void>
  openUrl(url: string): Promise<void>
  loadRecent(): Promise<void>
  openPr(): void
  closePr(): void
  createPr(title: string, body: string, base: string): Promise<void>
  openMerge(): void
  closeMerge(): void
  mergePr(method: MergeMethod, deleteBranch: boolean): Promise<void>
  /** Zjistit stav proti remote a stáhnout, když je to bezpečné převinutí. */
  syncWithRemote(folder: string, options?: { autoPull?: boolean }): Promise<void>
  /**
   * Při nejbližším načtení sekce stáhnout, když to jde.
   *
   * Záměr, ne akce: složka se teprve otevírá a stav sekce se přitom resetuje,
   * takže by se cokoli uloženého do něj ztratilo. Nastavuje to výběr
   * repozitáře před otevřením.
   */
  requestAutoPull(): void
  /** Stáhnout na vyžádání. */
  pull(folder?: string): Promise<void>
}

interface GitValue {
  view: GitView
  actions: GitActions
  api: GitApi
}

const GitContext = createContext<GitValue | null>(null)

/** Jak dlouho čekat, než se běh po pushi objeví, než se to vzdá. */
const RUN_APPEAR_TIMEOUT_MS = 3 * 60 * 1000

const initialView = (supported: boolean): GitView => ({
  folder: null,
  probed: false,
  probe: null,
  step: supported ? 'install-git' : 'unsupported',
  gh: 'not-github',
  account: null,
  remote: null,
  busy: null,
  changes: [],
  selected: [],
  touched: [],
  under: '',
  transcript: '',
  error: null,
  publishOpen: false,
  published: null,
  runs: [],
  jobs: {},
  watching: 'idle',
  workflows: [],
  prOpen: false,
  prUrl: null,
  lastMessage: '',
  prError: null,
  pr: null,
  mergeMethods: { merge: true, squash: true, rebase: true },
  mergeOpen: false,
  mergedNumber: null,
  sync: null,
  pulled: false,
  recent: null,
  recentError: null,
  deviceCode: null,
  checkedAt: null,
})

export function GitProvider({ children, git }: { children: ReactNode; git?: GitApi }) {
  const apiRef = useRef<GitApi>(git ?? createGit())
  const api = apiRef.current
  const { state } = useStore()
  // Stav gitu se drží pro jednu složku, i když jich je otevřených víc: tu
  // aktivní. Změna aktivní složky je pro `git-store` totéž co otevření jiné
  // -- pohled se zahodí a zjistí se znovu.
  const folder = activeFolder(state.explorer.folders, state.explorer.active)?.rootPath ?? null
  const touchedAbsolute = state.explorer.touched

  const [view, setView] = useState<GitView>(() => initialView(api.available))

  /**
   * Nejnovější pohled pro obsluhu, která běží mimo překreslení.
   *
   * Každá změna stavu jde přes `update`, které zapíše do refu hned a do
   * Reactu tímtéž krokem. Kousky výstupu chodí z procesu kdykoli a `refresh`
   * volá `refreshChanges` v tomtéž tahu, ve kterém uložil probe -- kdyby ref
   * čekal na překreslení, četlo by se z něj to, co platilo před chvílí.
   * Obejít `update` přímým `setView` by tuhle záruku tiše zrušilo.
   *
   * A hlavně: ref se **nepřepisuje při překreslení**. Stávalo tu
   * `viewRef.current = view`, což vypadá nevinně, ale je to závod. Překreslit
   * se dá i kvůli něčemu úplně jinému -- třeba proto, že se do nastavení
   * zapsalo, které složky jsou otevřené -- a takové překreslení nese `view`,
   * ve kterém poslední `update` ještě není. Tím se ref vrátil zpátky v čase
   * a `refresh` pak ve své druhé půlce viděl složku `null`, přestože ji
   * o řádek výš sám nastavil. Ref mění jenom `update`, a ten jde vždycky
   * dopředu.
   */
  const viewRef = useRef(view)
  const update = useCallback((fn: (current: GitView) => GitView) => {
    viewRef.current = fn(viewRef.current)
    setView(fn)
  }, [])
  const patch = useCallback(
    (next: Partial<GitView>) => update((current) => ({ ...current, ...next })),
    [update],
  )

  /** Co uživatel sám odškrtl. Tohle se při obnovení změn znovu nezaškrtne. */
  const deselected = useRef<Set<string>>(new Set())

  /**
   * Má se při nejbližším načtení sekce stáhnout?
   *
   * V refu, ne ve stavu: otevření složky stav sekce resetuje na výchozí,
   * takže cokoli uloženého do něj by se ztratilo dřív, než by se to použilo.
   */
  const autoPullRef = useRef(false)

  // -- změny -----------------------------------------------------------------

  /**
   * Načíst změny a rozhodnout, co je zaškrtnuté.
   *
   * Zaškrtnuté zůstává, co bylo; přibude, co zapsal Pilcrow a co uživatel
   * neodškrtl; zmizí, co už není změněné. Konflikt se nezaškrtne nikdy.
   */
  const refreshChanges = useCallback(async () => {
    const current = viewRef.current
    if (!current.folder || !current.probe?.repoRoot) return
    patch({ busy: current.busy ?? 'status' })
    try {
      const raw = await api.status(current.folder)
      const changes = parseGitStatus(raw, current.under)
      const touchedSet = new Set(current.touched)
      const previous = new Set(current.selected)
      const selected = changes
        .filter(isCommittable)
        .filter((file) => previous.has(file.path) || (touchedSet.has(file.path) && !deselected.current.has(file.path)))
        .map((file) => file.path)
      update((view) => ({
        ...view,
        busy: view.busy === 'status' ? null : view.busy,
        changes,
        selected,
        error: null,
      }))
    } catch (error) {
      update((view) => ({
        ...view,
        busy: view.busy === 'status' ? null : view.busy,
        error: gitMessage(error, t.git.statusFailed),
      }))
    }
  }, [api, patch, update])

  // -- stav proti remote ------------------------------------------------------

  /**
   * Stáhnout, co na remote přibylo.
   *
   * Vždycky jen převinutí. Kdo má rozdělanou práci nebo rozešlé větve, si
   * o to musí říct v terminálu -- tady by se z toho stal konflikt uprostřed
   * dokumentace.
   */
  const pull = useCallback(async (folder?: string) => {
    const target = folder ?? viewRef.current.folder
    if (!target || viewRef.current.busy) return
    patch({ busy: 'pull', transcript: '', error: null })

    let transcript = ''
    try {
      await api.pull(target, (chunk) => {
        if (chunk.kind === 'out') {
          transcript += chunk.text
          patch({ transcript })
          return
        }
        if (chunk.kind === 'failed') {
          patch({ busy: null, error: chunk.message || t.git.pullFailed })
          return
        }
        patch({ busy: null, pulled: true })
        void refresh()
      })
    } catch (error) {
      patch({ busy: null, error: gitMessage(error, t.git.pullFailed) })
    }
  }, [api, patch])

  /**
   * Zeptat se remote, jak na tom jsme, a případně rovnou stáhnout.
   *
   * `autoPull` zapíná otevření repozitáře: tam uživatel chce aktuální
   * dokumentaci, ne tu z minulého týdne. Stáhne se ale jen tehdy, když je to
   * čisté převinutí -- `canFastForward` je jediné místo, které to rozhoduje.
   */
  const syncWithRemote = useCallback(
    async (folder: string, options: { autoPull?: boolean } = {}) => {
      if (!folder) return
      try {
        const sync = parseSyncState(await api.syncState(folder))
        patch({ sync })
        if (options.autoPull && canFastForward(sync)) await pull(folder)
      } catch (error) {
        patch({ sync: null, error: gitMessage(error, t.git.syncFailed) })
      }
    },
    [api, patch, pull],
  )

  // -- stav ------------------------------------------------------------------

  const loadPullRequest = useCallback(
    async (folder: string, branch: string) => {
      // Složka i větev se předávají, netahají se z `viewRef`: ten se mezi
      // dotazem na stav a touhle funkcí stihne přepsat, a načítalo by se
      // pro složku, která už není otevřená -- nebo pro žádnou.
      if (!folder || !branch || viewRef.current.gh !== 'ready') return
      try {
        const [raw, methods] = await Promise.all([
          api.pullRequest(folder, branch),
          api.mergeMethods(folder).catch(() => ''),
        ])
        patch({ pr: parsePullRequest(raw), mergeMethods: parseMergeMethods(methods) })
      } catch (error) {
        // Do panelu, ne do ticha: bez tohohle se prostě neukáže tlačítko
        // sloučit a nikdo se nedozví proč.
        patch({ pr: null, error: gitMessage(error, t.git.prLoadFailed) })
      }
    },
    [api, patch],
  )


  /**
   * Zjistit, jak na tom git a gh jsou, a hned načíst změny.
   *
   * Nic se nekešuje: stav se zjišťuje po otevření složky a po každém kroku,
   * a má vidět dnešek.
   */
  const refresh = useCallback(async () => {
    const target = viewRef.current.folder
    if (!target) return
    if (!api.available) {
      patch({ step: 'unsupported', probed: true, probe: null })
      return
    }
    patch({ busy: 'probe', error: null })
    try {
      const probe = await api.probe(target)
      if (viewRef.current.folder !== target) return
      const remote = parseRemote(probe.remoteUrl)
      const under = probe.repoRoot ? (toRepoRelative(probe.repoRoot, target) ?? '') : ''
      const touched = probe.repoRoot
        ? touchedAbsolute
            .map((path) => toRepoRelative(probe.repoRoot, path))
            .filter((path): path is string => path !== null && path !== '')
        : []
      patch({
        busy: null,
        probed: true,
        probe,
        step: gitStep(probe, true),
        gh: ghStep(probe, remote),
        account: parseGhAuth(probe.ghAuth),
        remote,
        under,
        touched,
        error: probe.error || null,
      })
      if (gitStep(probe, true) === 'ready') {
        await refreshChanges()
        const autoPull = autoPullRef.current
        autoPullRef.current = false
        void syncWithRemote(target, { autoPull })
        // I po restartu aplikace: otevřený PR pro aktuální větev se najde
        // podle ní, ne podle čísla, které si pamatuje jen běžící sezení.
        void loadPullRequest(target, probe.branch)
      }
      // Až tady, ne po probe: „zjištěno v“ má platit pro stav i pro změny,
      // což je přesně to, co tlačítko slibuje.
      if (viewRef.current.folder === target) patch({ checkedAt: Date.now() })
    } catch (error) {
      if (viewRef.current.folder !== target) return
      patch({ busy: null, probed: true, error: gitMessage(error, t.git.failed) })
    }
  }, [api, loadPullRequest, patch, refreshChanges, syncWithRemote, touchedAbsolute])

  // Nová složka = nový začátek. Všechno, co platilo k té staré, se zahodí.
  useEffect(() => {
    deselected.current = new Set()
    update(() => ({ ...initialView(api.available), folder }))
    if (!folder) return
    void refresh()
    // `refresh` čte složku z viewRef, který se právě nastavil; závislost na něm
    // by tenhle efekt spouštěla i při změně zapsaných souborů.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api.available, folder])

  // Pilcrow něco zapsal: přepočítat, co je „naše“, a obnovit změny.
  useEffect(() => {
    const current = viewRef.current
    if (!current.probe?.repoRoot || current.step !== 'ready') return
    const touched = touchedAbsolute
      .map((path) => toRepoRelative(current.probe!.repoRoot, path))
      .filter((path): path is string => path !== null && path !== '')
    patch({ touched })
    void refreshChanges()
  }, [patch, refreshChanges, touchedAbsolute])

  // -- výběr -----------------------------------------------------------------

  const toggleFile = useCallback(
    (path: string) => {
      update((view) => {
        const file = view.changes.find((candidate) => candidate.path === path)
        if (!file || !isCommittable(file)) return view
        if (view.selected.includes(path)) {
          deselected.current.add(path)
          return { ...view, selected: view.selected.filter((candidate) => candidate !== path) }
        }
        deselected.current.delete(path)
        return { ...view, selected: [...view.selected, path] }
      })
    },
    [update],
  )

  const selectAll = useCallback(() => {
    update((view) => {
      const selected = view.changes.filter(isCommittable).map((file) => file.path)
      for (const path of selected) deselected.current.delete(path)
      return { ...view, selected }
    })
  }, [update])

  const selectNone = useCallback(() => {
    update((view) => {
      for (const path of view.selected) deselected.current.add(path)
      return { ...view, selected: [] }
    })
  }, [update])

  // -- odeslání --------------------------------------------------------------

  /**
   * Zjistit, jestli pro odeslanou větev existuje otevřený PR.
   *
   * Hledá se podle větve, ne podle čísla, které si zapamatovala aplikace:
   * PR mohl vzniknout i v prohlížeči a po restartu by o něm jinak nevěděla.
   */
  /** Po úspěšném pushi: nový stav repa, a začít hlídat běh. */
  const afterPush = useCallback(async () => {
    const current = viewRef.current
    if (!current.folder || !current.published) return
    let probe: GitProbe | null = null
    try {
      probe = await api.probe(current.folder)
    } catch {
      /* stav se nepodařilo znovu zjistit; větev je odeslaná i tak */
    }
    const remote = probe ? parseRemote(probe.remoteUrl) : current.remote
    const gh = probe ? ghStep(probe, remote) : current.gh

    // Než se začne vyhlížet běh: existuje vůbec nějaký workflow? Repozitář
    // bez nich žádný nespustí a mlčky u toho čekat tři minuty je horší, než
    // to rovnou říct.
    let workflows: Workflow[] = []
    if (gh === 'ready') {
      try {
        workflows = activeWorkflows(parseWorkflows(await api.workflows(current.folder)))
      } catch {
        /* nepodařilo se zjistit; čeká se jako dřív */
      }
    }

    update((view) => ({
      ...view,
      busy: null,
      probe: probe ?? view.probe,
      remote,
      gh,
      step: probe ? gitStep(probe, true) : view.step,
      published: view.published
        ? { ...view.published, sha: probe?.headSha ?? view.published.sha, pushed: true, retryable: false }
        : null,
      runs: [],
      jobs: {},
      workflows,
      watching:
        gh !== 'ready' || !probe?.headSha ? 'idle' : workflows.length === 0 ? 'none' : 'waiting',
    }))
    await refreshChanges()
    void loadPullRequest(current.folder, viewRef.current.published?.branch ?? '')
  }, [api, loadPullRequest, refreshChanges, update])

  /** Obsluha kousků výstupu pro odeslání i opakovaný push. */
  const publishSink = useCallback(
    (kind: 'publish' | 'push') => {
      let transcript = ''
      return (chunk: GitChunk) => {
        if (chunk.kind === 'out') {
          transcript += chunk.text
          patch({ transcript })
          return
        }
        if (chunk.kind === 'failed') {
          const step = currentPublishStep(transcript) ?? ''
          const atPush = step.startsWith('git push')
          update((view) => ({
            ...view,
            busy: null,
            error: chunk.message || t.git.publishFailed,
            // Když spadl push, commit už je a dá se to zkusit znovu. Když
            // spadlo něco dřív, není co opakovat -- karta by lhala.
            published:
              view.published && (atPush || kind === 'push')
                ? { ...view.published, pushed: false, retryable: true }
                : null,
          }))
          return
        }
        void afterPush()
      }
    },
    [afterPush, patch, update],
  )

  const publish = useCallback(
    async (message: string, branch: string) => {
      const current = viewRef.current
      if (!current.folder || !current.probe || current.busy) return
      const files = current.selected
      if (files.length === 0) return

      patch({
        busy: 'publish',
        transcript: '',
        error: null,
        publishOpen: false,
        // Základ PR je **výchozí větev repozitáře**, ne ta, na které uživatel
        // stojí. Po prvním odeslání stojí na `docs/…`; tu pak zmerguje,
        // GitHub ji smaže a PR z druhého kola by neměl kam mířit.
        published: {
          branch,
          base: current.probe.defaultBranch || current.probe.branch,
          sha: '',
          pushed: false,
          retryable: false,
        },
        lastMessage: message,
        prUrl: null,
        runs: [],
        jobs: {},
        watching: 'idle',
      })
      try {
        await api.publish({ folder: current.folder, files, message, branch }, publishSink('publish'))
      } catch (error) {
        patch({ busy: null, published: null, error: gitMessage(error, t.git.publishFailed) })
      }
    },
    [api, patch, publishSink],
  )

  const retryPush = useCallback(async () => {
    const current = viewRef.current
    if (!current.folder || !current.published || current.busy) return
    patch({ busy: 'push', transcript: '', error: null })
    try {
      await api.push(current.folder, current.published.branch, publishSink('push'))
    } catch (error) {
      patch({ busy: null, error: gitMessage(error, t.git.publishFailed) })
    }
  }, [api, patch, publishSink])

  const cancel = useCallback(async () => {
    await api.cancel().catch(() => undefined)
    patch({ busy: null })
  }, [api, patch])

  const dismissPublished = useCallback(() => {
    patch({
      published: null,
      runs: [],
      jobs: {},
      workflows: [],
      watching: 'idle',
      transcript: '',
      error: null,
      prUrl: null,
      pr: null,
      mergedNumber: null,
    })
  }, [patch])

  // -- sledování běhu --------------------------------------------------------

  /**
   * Ptát se GitHubu, dokud běh nedoběhne.
   *
   * Nejdřív se čeká, až se běh pro náš commit vůbec objeví -- to trvá
   * i desítky vteřin a není to chyba. Pak se každých pár vteřin načtou běhy
   * i jejich úlohy, dokud všechny neskončí. Řetěz `setTimeout`, ne interval:
   * další dotaz jde až po odpovědi na ten předchozí.
   */
  useEffect(() => {
    if (view.watching !== 'waiting' && view.watching !== 'running') return
    const sha = view.published?.sha
    const target = view.folder
    if (!sha || !target) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const startedAt = Date.now()

    const tick = async () => {
      if (cancelled) return
      try {
        const runs = parseRuns(await api.runs(target, sha))
        if (cancelled) return
        if (runs.length === 0) {
          if (Date.now() - startedAt > RUN_APPEAR_TIMEOUT_MS) {
            patch({ watching: 'timeout' })
            return
          }
        } else {
          const jobs: Record<number, WorkflowJob[]> = {}
          for (const run of runs) {
            try {
              jobs[run.id] = parseJobs(await api.jobs(target, run.id))
            } catch {
              jobs[run.id] = viewRef.current.jobs[run.id] ?? []
            }
          }
          if (cancelled) return
          patch({ runs, jobs, watching: runsSettled(runs) ? 'done' : 'running' })
          if (runsSettled(runs)) return
        }
      } catch (error) {
        if (cancelled) return
        patch({ watching: 'idle', error: gitMessage(error, t.git.failed) })
        return
      }
      timer = setTimeout(() => void tick(), api.pollMs)
    }

    timer = setTimeout(() => void tick(), 0)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
    // Znovu se rozběhne jen při změně toho, co sleduje.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, patch, view.watching, view.published?.sha, view.folder])

  const loadRecent = useCallback(async () => {
    const target = viewRef.current.folder
    if (!target) return
    try {
      const recent = parseRuns(await api.recentRuns(target))
      patch({ recent, recentError: null })
    } catch (error) {
      patch({ recent: [], recentError: gitMessage(error, t.git.recentFailed) })
    }
  }, [api, patch])

  // -- přihlášení ------------------------------------------------------------

  const login = useCallback(async () => {
    patch({ busy: 'login', transcript: '', deviceCode: null, error: null })
    let transcript = ''
    try {
      await api.login((chunk) => {
        if (chunk.kind === 'out') {
          transcript += chunk.text
          patch({ transcript, deviceCode: findDeviceCode(transcript) })
          return
        }
        if (chunk.kind === 'failed') {
          patch({ busy: null, deviceCode: null, error: chunk.message || t.git.loginFailed })
          return
        }
        patch({ busy: null, deviceCode: null })
        void refresh()
      })
    } catch (error) {
      patch({ busy: null, deviceCode: null, error: gitMessage(error, t.git.loginFailed) })
    }
  }, [api, patch, refresh])

  const cancelLogin = useCallback(async () => {
    await api.loginCancel().catch(() => undefined)
    patch({ busy: null, deviceCode: null, transcript: '' })
  }, [api, patch])

  // -- prohlížeč -------------------------------------------------------------

  const openUrl = useCallback(
    async (url: string) => {
      try {
        await api.openUrl(url)
      } catch (error) {
        patch({ error: gitMessage(error, t.git.failed) })
      }
    },
    [api, patch],
  )

  const openCompare = useCallback(async () => {
    const { remote, published } = viewRef.current
    if (!remote || !published) return
    await openUrl(compareUrl(remote, published.base, published.branch))
  }, [openUrl])

  const openActions = useCallback(async () => {
    const { remote } = viewRef.current
    if (!remote) return
    await openUrl(actionsUrl(remote))
  }, [openUrl])

  /**
   * Sloučit pull request a uklidit po něm.
   *
   * Nevratné a děje se to na GitHubu, takže se sem jde jen přes tlačítko
   * a potvrzovací dialog, kde je vypsané, co přesně se stane.
   */
  const mergePr = useCallback(
    async (method: MergeMethod, deleteBranch: boolean) => {
      const current = viewRef.current
      if (!current.folder || !current.pr || current.busy) return
      patch({ busy: 'merge', prError: null, transcript: '' })

      let transcript = ''
      try {
        await api.mergePr(
          {
            folder: current.folder,
            number: current.pr.number,
            method,
            base: current.pr.baseRefName,
            head: current.pr.headRefName,
            deleteBranch,
          },
          (chunk) => {
            if (chunk.kind === 'out') {
              transcript += chunk.text
              patch({ transcript })
              return
            }
            if (chunk.kind === 'failed') {
              patch({ busy: null, prError: chunk.message || t.git.mergeFailed })
              return
            }
            patch({
              busy: null,
              mergeOpen: false,
              mergedNumber: current.pr?.number ?? null,
              pr: null,
            })
            // Po sloučení stojí repozitář jinde: nová větev, nové změny.
            void refresh()
          },
        )
      } catch (error) {
        patch({ busy: null, prError: gitMessage(error, t.git.mergeFailed) })
      }
    },
    [api, patch, refresh],
  )

  /**
   * Založit pull request bez prohlížeče.
   *
   * Dělá to `gh pr create`, takže se nikam neotevírá okno a adresa hotového
   * PR se vrátí rovnou do panelu.
   */
  const createPr = useCallback(
    async (title: string, body: string, base: string) => {
      const current = viewRef.current
      if (!current.folder || !current.published || current.busy) return
      patch({ busy: 'pr', prError: null })
      try {
        const url = await api.createPr({
          folder: current.folder,
          base,
          head: current.published.branch,
          title,
          body,
        })
        patch({ busy: null, prOpen: false, prUrl: url, prError: null })
        void loadPullRequest(current.folder, current.published.branch)
      } catch (error) {
        // Chyba patří do dialogu, ne do panelu za ním -- tam ji nikdo nevidí.
        patch({ busy: null, prError: gitMessage(error, t.git.prFailed) })
      }
    },
    [api, loadPullRequest, patch],
  )

  const actions = useMemo<GitActions>(
    () => ({
      refresh,
      refreshChanges,
      toggleFile,
      selectAll,
      selectNone,
      openPublish: () => patch({ publishOpen: true }),
      closePublish: () => patch({ publishOpen: false }),
      publish,
      retryPush,
      cancel,
      dismissPublished,
      login,
      cancelLogin,
      openCompare,
      openActions,
      openUrl,
      loadRecent,
      syncWithRemote,
      requestAutoPull: () => {
        autoPullRef.current = true
      },
      pull,
      openPr: () => patch({ prOpen: true, prError: null }),
      closePr: () => patch({ prOpen: false, prError: null }),
      createPr,
      openMerge: () => patch({ mergeOpen: true, prError: null }),
      closeMerge: () => patch({ mergeOpen: false, prError: null }),
      mergePr,
    }),
    [
      cancel,
      cancelLogin,
      createPr,
      dismissPublished,
      mergePr,
      loadRecent,
      login,
      openActions,
      openCompare,
      pull,
      syncWithRemote,
      openUrl,
      patch,
      publish,
      refresh,
      refreshChanges,
      retryPush,
      selectAll,
      selectNone,
      toggleFile,
    ],
  )

  const value = useMemo<GitValue>(() => ({ view, actions, api }), [actions, api, view])

  return <GitContext.Provider value={value}>{children}</GitContext.Provider>
}

export function useGit(): GitValue {
  const value = useContext(GitContext)
  if (!value) throw new Error('useGit must be used inside <GitProvider>')
  return value
}
