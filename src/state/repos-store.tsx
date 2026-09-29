/**
 * Výběr repozitáře na GitHubu.
 *
 * Vstupní bod k celé práci s gitem: přihlásíš se, uvidíš svoje repozitáře,
 * jeden vybereš a Pilcrow ho otevře jako složku -- buď rovnou, když už na
 * disku je, nebo ho nejdřív stáhne. Odtamtud přebírá `git-store`, který
 * pracuje s otevřenou složkou.
 *
 * Tři věci, na kterých to stojí:
 *
 *  1. **Naklonováno se pozná podle remote, ne podle jména složky.** Kdyby se
 *     porovnávala jména, `things-3` by aplikace nespárovala s `Notes_MJ`
 *     a stahovala by podruhé, co už na disku je.
 *  2. **Kam se stahuje, vybírá uživatel pokaždé znovu.** Dialog začne ve
 *     složce, kam se stahovalo minule, ale zeptá se vždycky. Tam se zároveň
 *     udělí přístup -- Pilcrow si žádnou cestu nevymýšlí.
 *  3. **„Soubory mám jinde“ na soubory nesahá.** Vybraná složka se napojí na
 *     repozitář tak, že v ní zůstane všechno, jak bylo; git pak jen ukáže,
 *     čím se liší od main. Cizí repozitář se nenapojí nikdy.
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
  findFolder,
  ghProbeStep,
  inspectionKind,
  matchClones,
  parseClones,
  parseFolderInspection,
  parseGhAuth,
  parseRepos,
  sameFolder,
  sortRepos,
  t,
  withRepoFolder,
  type CloneProgress,
  type GhAccount,
  type GhProbe,
  type InspectionKind,
  type Repo,
} from '@/core'
import { gitMessage } from '@/git'

import { useGit } from './git-store'
import { useStore } from './store'

export type ReposBusy = 'probe' | 'login' | 'clone' | 'inspect' | 'link' | null

/** Rozdělané „soubory mám jinde“: složka je vybraná, čeká se na potvrzení. */
export interface PendingLink {
  repo: Repo
  folder: string
  kind: InspectionKind
  /** Kořen repozitáře, ve kterém složka leží, když v nějakém leží. */
  root: string
  /** `origin` toho repozitáře. */
  remote: string
  markdownFiles: number
}

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
  /**
   * Výchozí složka: tam začne dialog „kam stáhnout“ a tam se hledá, co už je
   * na disku. Prázdné, dokud se nic nestahovalo.
   */
  folder: string
  /** Které repo se zrovna stahuje, jménem. */
  cloning: string | null
  progress: CloneProgress | null
  /** Napojení složky, které čeká na potvrzení nebo právě běží. */
  link: PendingLink | null
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
  /** Vybrat výchozí složku pro repozitáře. */
  pickFolder(): Promise<void>
  /** Otevřít repozitář, který už na disku je. */
  openRepo(repo: Repo): Promise<void>
  /** Zeptat se, kam stáhnout, stáhnout a otevřít. */
  cloneRepo(repo: Repo): Promise<void>
  /** „Soubory mám jinde“: vybrat složku a zjistit, jestli se dá napojit. */
  linkRepo(repo: Repo): Promise<void>
  /** Potvrdit napojení vybrané složky. */
  confirmLink(): Promise<void>
  /** Zahodit rozdělané napojení a vrátit se k seznamu. */
  cancelLink(): void
  /** Zastavit napojení, které právě běží. Co stihlo vzniknout, se uklidí. */
  stopLink(): Promise<void>
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
  link: null,
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
   * Nastavení a průzkumník, jak platí teď.
   *
   * Obsluha stahování a napojení běží dlouho po vykreslení, které ji
   * spustilo; mapu `repoFolders` z té doby by přepsala tím, co v ní bylo
   * před minutou.
   */
  const stateRef = useRef(state)
  stateRef.current = state

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
      const chosen = stateRef.current.settings.repoFolders ?? {}
      const extra = Object.values(chosen)
      let clones: ReturnType<typeof parseClones> = []
      if (folder || extra.length > 0) {
        try {
          clones = parseClones(await api.clones(folder, extra))
        } catch {
          /* disk se přečíst nedá; seznam dává smysl i bez značek */
        }
      }
      patch({ busy: null, repos: sortRepos(matchClones(repos, clones, chosen)) })
    } catch (error) {
      patch({ busy: null, probed: true, error: gitMessage(error, t.repos.failed) })
    }
  }, [api, patch])

  /**
   * Rozběhnuté napojení se zavřením okna nezastaví -- takže o něm okno nesmí
   * zapomenout. Po znovuotevření ukáže, že pořád běží.
   */
  const keepLink = () => (viewRef.current.busy === 'link' ? viewRef.current.link : null)

  const open = useCallback(() => {
    patch({ open: true, folder: state.settings.reposFolder, error: null, link: keepLink() })
    // Ref musí složku vidět dřív, než ji `refresh` použije pro čtení disku.
    viewRef.current = { ...viewRef.current, folder: state.settings.reposFolder }
    void refresh()
  }, [patch, refresh, state.settings.reposFolder])

  const close = useCallback(() => {
    const running = viewRef.current.busy === 'link'
    patch({
      open: false,
      query: '',
      error: null,
      transcript: running ? viewRef.current.transcript : '',
      progress: null,
      cloning: null,
      link: keepLink(),
    })
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
   * Vybrat výchozí složku pro repozitáře.
   *
   * Přístup se uděluje právě tady, v nativním dialogu. Uloží se do nastavení;
   * při stažení se dialog „kam“ otevře v ní.
   */
  const pickFolder = useCallback(async () => {
    try {
      const picked = await vault.openFolderDialog({
        title: t.repos.pickFolderTitle,
        defaultPath: viewRef.current.folder || undefined,
      })
      if (!picked) return
      await storeActions.updateSettings({ reposFolder: picked })
      patch({ folder: picked })
      viewRef.current = { ...viewRef.current, folder: picked }
      await refresh()
    } catch (error) {
      patch({ error: gitMessage(error, t.repos.failed) })
    }
  }, [patch, refresh, storeActions, vault])

  /** Zapamatovat si, kde repozitář leží, ať ho příště najde i mimo výchozí složku. */
  const remember = useCallback(
    async (repo: Repo, path: string, extra: { reposFolder?: string } = {}) => {
      const folders = stateRef.current.settings.repoFolders ?? {}
      await storeActions
        .updateSettings({ ...extra, repoFolders: withRepoFolder(folders, repo.fullName, path) })
        .catch(() => undefined)
    },
    [storeActions],
  )

  // -- otevření a stažení ----------------------------------------------------

  const openRepo = useCallback(
    async (repo: Repo) => {
      if (!repo.localPath) return
      close()
      // Otevřít už stažené repo znamená nejspíš „dej mi aktuální
      // dokumentaci“, ne tu z minulého týdne. Samo se ale nestáhne nic:
      // když je na GitHubu něco nového, otevře se okno, ve kterém si
      // uživatel vybere, odkud a jestli vůbec. Záměr se ohlásí *před*
      // otevřením, protože otevření stav sekce resetuje.
      gitActions.requestSyncPrompt(repo.localPath)
      await storeActions.openFolderAt(repo.localPath)
    },
    [close, gitActions, storeActions],
  )

  const cloneRepo = useCallback(
    async (repo: Repo) => {
      // Kam, se ptá pokaždé -- začne se tam, kam se stahovalo minule.
      let parent: string | null
      try {
        parent = await vault.openFolderDialog({
          title: t.repos.cloneWhere(repo.fullName),
          defaultPath: viewRef.current.folder || undefined,
        })
      } catch (error) {
        patch({ error: gitMessage(error, t.repos.cloneFailed) })
        return
      }
      if (!parent) return
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
        const target = done.target
        close()
        // Příště se dialog otevře tady, a repozitář se najde, i kdyby tahle
        // složka přestala být výchozí.
        void remember(repo, target, { reposFolder: parent ?? undefined }).then(() =>
          storeActions.openFolderAt(target),
        )
      }

      let transcript = ''
      try {
        done.target = await api.clone(
          { repo: repo.fullName, parent, folder: cloneFolderName(repo) },
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
    [api, close, patch, remember, storeActions, vault],
  )

  // -- soubory mám jinde -----------------------------------------------------

  /**
   * Začít používat složku jako zdroj souborů repozitáře.
   *
   * Stará kopie -- pokud je otevřená -- uhne: dvě složky téhož repozitáře
   * vedle sebe by jen mátly, do které se píše. A první, co se po otevření
   * ukáže, je porovnání s výchozí větví.
   */
  const adopt = useCallback(
    async (repo: Repo, folder: string) => {
      await remember(repo, folder)
      close()
      const explorer = stateRef.current.explorer
      if (repo.localPath && !sameFolder(repo.localPath, folder) && findFolder(explorer.folders, repo.localPath)) {
        storeActions.closeFolder(repo.localPath)
      }
      const alreadyActive = sameFolder(explorer.active ?? '', folder)
      gitActions.requestCompare(folder)
      await storeActions.openFolderAt(folder)
      // Sekce Git se přestaví sama jen při změně aktivní složky. Když to
      // byla ta, co už byla otevřená, musí se o nový stav říct.
      if (alreadyActive) void gitActions.refresh()
    },
    [close, gitActions, remember, storeActions],
  )

  const linkRepo = useCallback(
    async (repo: Repo) => {
      let folder: string | null
      try {
        folder = await vault.openFolderDialog({
          title: t.repos.linkWhere(repo.fullName),
          defaultPath: repo.localPath ?? (viewRef.current.folder || undefined),
        })
      } catch (error) {
        patch({ error: gitMessage(error, t.repos.linkFailed) })
        return
      }
      if (!folder) return

      patch({ busy: 'inspect', error: null, link: null })
      try {
        const inspection = parseFolderInspection(await api.inspectFolder(folder))
        if (!inspection) throw new Error(t.repos.linkFailed)
        const kind = inspectionKind(inspection, repo.cloneUrl)
        if (kind === 'same') {
          // Už je to kopie téhož repozitáře: není co zakládat.
          patch({ busy: null })
          await adopt(repo, folder)
          return
        }
        patch({
          busy: null,
          link: {
            repo,
            folder,
            kind,
            root: inspection.root,
            remote: inspection.remote,
            markdownFiles: inspection.markdownFiles,
          },
        })
      } catch (error) {
        patch({ busy: null, error: gitMessage(error, t.repos.linkFailed) })
      }
    },
    [adopt, api, patch, vault],
  )

  const confirmLink = useCallback(async () => {
    const link = viewRef.current.link
    if (!link || link.kind !== 'plain' || viewRef.current.busy) return
    const { repo, folder } = link
    if (!repo.defaultBranch) {
      patch({ error: t.repos.linkNeedsDefault })
      return
    }
    patch({ busy: 'link', transcript: '', error: null })

    let transcript = ''
    try {
      await api.linkFolder({ folder, remoteUrl: repo.cloneUrl, defaultBranch: repo.defaultBranch }, (chunk) => {
        if (chunk.kind === 'out') {
          transcript += chunk.text
          patch({ transcript })
          return
        }
        if (chunk.kind === 'failed') {
          patch({ busy: null, error: chunk.message || t.repos.linkFailed })
          return
        }
        patch({ busy: null })
        void adopt(repo, folder)
      })
    } catch (error) {
      patch({ busy: null, error: gitMessage(error, t.repos.linkFailed) })
    }
  }, [adopt, api, patch])

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
      linkRepo,
      confirmLink,
      cancelLink: () => patch({ link: null, error: null, transcript: '' }),
      stopLink: async () => {
        await api.cancel().catch(() => undefined)
      },
    }),
    [api, cancelLogin, cloneRepo, close, confirmLink, linkRepo, login, open, openRepo, patch, pickFolder, refresh],
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
