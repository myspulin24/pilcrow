/**
 * Výběr repozitáře na GitHubu.
 *
 * Vstupní bod k celé práci s gitem: přihlásíš se, uvidíš svoje repozitáře,
 * jeden vybereš a Pilcrow ho otevře jako složku -- buď rovnou, když už na
 * disku je, nebo ho nejdřív stáhne. Odtamtud přebírá `git-store`, který
 * pracuje s otevřenou složkou.
 *
 * Dvě věci, na kterých to stojí:
 *
 *  1. **Naklonováno se pozná podle remote, ne podle jména složky.** Kdyby se
 *     porovnávala jména, `things-3` by aplikace nespárovala s `Notes_MJ`
 *     a stahovala by podruhé, co už na disku je.
 *  2. **Složku, kam se stahuje, vybírá uživatel v dialogu.** Tam se zároveň
 *     udělí přístup. Pilcrow si žádnou cestu nevymýšlí -- je to jediné místo,
 *     kam aplikace zapisuje mimo trezor.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import {
  cloneFolderName,
  cloneProgress,
  filterRepos,
  findDeviceCode,
  ghProbeStep,
  matchClones,
  parseClones,
  parseGhAuth,
  parseRepos,
  sortRepos,
  t,
  type CloneProgress,
  type GhAccount,
  type GhProbe,
  type Repo,
} from '@/core'
import { gitMessage } from '@/git'

import { useGit } from './git-store'
import { useStore } from './store'

export type ReposBusy = 'probe' | 'login' | 'clone' | null

export interface ReposView {
  open: boolean
  busy: ReposBusy
  probed: boolean
  probe: GhProbe | null
  step: 'install' | 'login' | 'ready'
  account: GhAccount | null
  /** Repozitáře i s tím, které z nich už leží na disku. */
  repos: Repo[]
  query: string
  /** Kam se stahuje. Prázdné, dokud si uživatel složku nevybere. */
  folder: string
  /** Které repo se zrovna stahuje, jménem. */
  cloning: string | null
  progress: CloneProgress | null
  transcript: string
  deviceCode: string | null
  error: string | null
}

export interface ReposActions {
  open(): void
  close(): void
  refresh(): Promise<void>
  setQuery(query: string): void
  login(): Promise<void>
  cancelLogin(): Promise<void>
  pickFolder(): Promise<void>
  /** Otevřít repozitář, který už na disku je. */
  openRepo(repo: Repo): Promise<void>
  /** Stáhnout a otevřít. */
  cloneRepo(repo: Repo): Promise<void>
}

interface ReposValue {
  view: ReposView
  actions: ReposActions
}

const ReposContext = createContext<ReposValue | null>(null)

const initialView: ReposView = {
  open: false,
  busy: null,
  probed: false,
  probe: null,
  step: 'install',
  account: null,
  repos: [],
  query: '',
  folder: '',
  cloning: null,
  progress: null,
  transcript: '',
  deviceCode: null,
  error: null,
}

export function ReposProvider({ children }: { children: ReactNode }) {
  const { api, actions: gitActions } = useGit()
  const { state, actions: storeActions, vault } = useStore()

  const [view, setView] = useState<ReposView>(initialView)
  const viewRef = useRef(view)
  viewRef.current = view
  const update = useCallback((fn: (current: ReposView) => ReposView) => {
    viewRef.current = fn(viewRef.current)
    setView(fn)
  }, [])
  const patch = useCallback(
    (next: Partial<ReposView>) => update((current) => ({ ...current, ...next })),
    [update],
  )

  /**
   * Zjistit stav `gh` a načíst seznam.
   *
   * Seznam i obsah složky se čtou zvlášť a spárují se tady: jedno je GitHub,
   * druhé disk, a ani jedno nemusí vyjít. Když selže čtení disku, repozitáře
   * se ukážou bez označení „naklonováno“ -- lepší než prázdný dialog.
   */
  const refresh = useCallback(async () => {
    if (!api.available) {
      patch({ probed: true, step: 'install', error: t.repos.unsupported })
      return
    }
    patch({ busy: 'probe', error: null })
    try {
      const probe = await api.ghStatus()
      const step = ghProbeStep(probe)
      patch({ probe, probed: true, step, account: parseGhAuth(probe.auth), error: probe.error || null })
      if (step !== 'ready') {
        patch({ busy: null })
        return
      }

      const repos = parseRepos(await api.repos())
      const folder = viewRef.current.folder
      let clones: ReturnType<typeof parseClones> = []
      if (folder) {
        try {
          clones = parseClones(await api.clones(folder))
        } catch {
          /* disk se přečíst nedá; seznam dává smysl i bez značek */
        }
      }
      patch({ busy: null, repos: sortRepos(matchClones(repos, clones)) })
    } catch (error) {
      patch({ busy: null, probed: true, error: gitMessage(error, t.repos.failed) })
    }
  }, [api, patch])

  const open = useCallback(() => {
    patch({ open: true, folder: state.settings.reposFolder, error: null })
    // Ref musí složku vidět dřív, než ji `refresh` použije pro čtení disku.
    viewRef.current = { ...viewRef.current, folder: state.settings.reposFolder }
    void refresh()
  }, [patch, refresh, state.settings.reposFolder])

  const close = useCallback(() => {
    patch({ open: false, query: '', error: null, transcript: '', progress: null, cloning: null })
  }, [patch])

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

  // -- složka ----------------------------------------------------------------

  /**
   * Vybrat složku, kam se budou repozitáře stahovat.
   *
   * Přístup se uděluje právě tady, v nativním dialogu. Uloží se do nastavení,
   * aby ji příště nebylo nutné vybírat znovu.
   */
  const pickFolder = useCallback(async () => {
    try {
      const picked = await vault.pickFolder(t.repos.pickFolderTitle)
      if (!picked) return
      await storeActions.updateSettings({ reposFolder: picked })
      patch({ folder: picked })
      viewRef.current = { ...viewRef.current, folder: picked }
      await refresh()
    } catch (error) {
      patch({ error: gitMessage(error, t.repos.failed) })
    }
  }, [patch, refresh, storeActions, vault])

  // -- otevření a stažení ----------------------------------------------------

  const openRepo = useCallback(
    async (repo: Repo) => {
      if (!repo.localPath) return
      close()
      // Otevřít už stažené repo znamená „dej mi aktuální dokumentaci“, ne tu
      // z minulého týdne. Záměr se ohlásí *před* otevřením: otevření stav
      // sekce resetuje, takže potom by se ztratil. Stáhne se jen bezpečné
      // převinutí -- rozhodnutí je v `canFastForward`, ne tady.
      gitActions.requestAutoPull()
      await storeActions.openFolderAt(repo.localPath)
    },
    [close, gitActions, storeActions],
  )

  const cloneRepo = useCallback(
    async (repo: Repo) => {
      const folder = viewRef.current.folder
      if (!folder) {
        await pickFolder()
        return
      }
      patch({ busy: 'clone', cloning: repo.fullName, transcript: '', progress: null, error: null })

      /**
       * Otevřít až tehdy, když je hotovo *a* je známá cesta.
       *
       * Obě zprávy můžou dorazit v libovolném pořadí: kanál je nezávislý na
       * tom, kdy se vrátí samotné volání. Spoléhat na jedno pořadí znamená
       * otevřít prázdnou cestu -- což se přesně stalo, než tohle vzniklo.
       */
      const done = { target: '', finished: false, opened: false }
      const finish = () => {
        if (done.opened || !done.finished || !done.target) return
        done.opened = true
        close()
        void storeActions.openFolderAt(done.target)
      }

      let transcript = ''
      try {
        done.target = await api.clone(
          { repo: repo.fullName, parent: folder, folder: cloneFolderName(repo) },
          (chunk) => {
            if (chunk.kind === 'out') {
              transcript += chunk.text
              patch({ transcript, progress: cloneProgress(transcript) })
              return
            }
            if (chunk.kind === 'failed') {
              patch({ busy: null, cloning: null, progress: null, error: chunk.message || t.repos.cloneFailed })
              return
            }
            patch({ busy: null, cloning: null, progress: null })
            done.finished = true
            finish()
          },
        )
        finish()
      } catch (error) {
        patch({ busy: null, cloning: null, progress: null, error: gitMessage(error, t.repos.cloneFailed) })
      }
    },
    [api, close, patch, pickFolder, storeActions],
  )

  const actions = useMemo<ReposActions>(
    () => ({
      open,
      close,
      refresh,
      setQuery: (query: string) => patch({ query }),
      login,
      cancelLogin,
      pickFolder,
      openRepo,
      cloneRepo,
    }),
    [cancelLogin, cloneRepo, close, login, open, openRepo, patch, pickFolder, refresh],
  )

  const value = useMemo<ReposValue>(() => ({ view, actions }), [actions, view])

  return <ReposContext.Provider value={value}>{children}</ReposContext.Provider>
}

export function useRepos(): ReposValue {
  const value = useContext(ReposContext)
  if (!value) throw new Error('useRepos must be used inside <ReposProvider>')
  return value
}

/** Seznam po filtru. Mimo store, aby se nepočítal při každé změně stavu. */
export function visibleRepos(view: ReposView): Repo[] {
  return filterRepos(view.repos, view.query)
}
