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
  compareUrl,
  currentPublishStep,
  findDeviceCode,
  ghStep,
  gitStep,
  isCommittable,
  parseGhAuth,
  parseGitStatus,
  parseJobs,
  parseRemote,
  parseRuns,
  runsSettled,
  t,
  toRepoRelative,
  type ChangedFile,
  type GhAccount,
  type GhStep,
  type GitProbe,
  type GitRemote,
  type GitStep,
  type WorkflowJob,
  type WorkflowRun,
} from '@/core'
import { createGit, gitMessage, type GitApi, type GitChunk } from '@/git'

import { useStore } from './store'

/** Co zrovna běží. Nikdy dvě věci naráz. */
export type GitBusy = 'probe' | 'status' | 'login' | 'publish' | 'push' | null

/** Kde je sledování běhu. */
export type Watching = 'idle' | 'waiting' | 'running' | 'done' | 'timeout'

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
  /** `null` = zatím nenačteno. */
  recent: WorkflowRun[] | null
  recentError: string | null
  deviceCode: string | null
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
  recent: null,
  recentError: null,
  deviceCode: null,
})

export function GitProvider({ children, git }: { children: ReactNode; git?: GitApi }) {
  const apiRef = useRef<GitApi>(git ?? createGit())
  const api = apiRef.current
  const { state } = useStore()
  const folder = state.explorer.tree ? state.explorer.rootPath : null
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
   */
  const viewRef = useRef(view)
  viewRef.current = view
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

  // -- stav ------------------------------------------------------------------

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
      if (gitStep(probe, true) === 'ready') await refreshChanges()
    } catch (error) {
      if (viewRef.current.folder !== target) return
      patch({ busy: null, probed: true, error: gitMessage(error, t.git.failed) })
    }
  }, [api, patch, refreshChanges, touchedAbsolute])

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
      watching: gh === 'ready' && probe?.headSha ? 'waiting' : 'idle',
    }))
    await refreshChanges()
  }, [api, refreshChanges, update])

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
        published: { branch, base: current.probe.branch, sha: '', pushed: false, retryable: false },
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
    patch({ published: null, runs: [], jobs: {}, watching: 'idle', transcript: '', error: null })
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
    }),
    [
      cancel,
      cancelLogin,
      dismissPublished,
      loadRecent,
      login,
      openActions,
      openCompare,
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
