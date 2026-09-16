/**
 * Application state.
 *
 * One reducer holds everything the UI renders; one `actions` object holds every
 * operation that talks to the vault. Actions are the only place that sequences
 * "parse -> write file -> update index -> refresh list", which keeps the
 * components purely declarative.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react'

import {
  applyBodyEdit,
  buildLinkIndex,
  createNoteFile,
  dailyNotePath,
  dailyNoteTemplate,
  decideExternalChange,
  hashText,
  isVaultError,
  joinNotePath,
  linkKey,
  parseNote,
  resolveLink,
  retitleNote,
  rewriteLinks,
  safeFileName,
  safeFolderPath,
  serializeNoteFile,
  setPinned,
  titleFromPath,
  toggleTask,
  uniquePath,
  validateNoteName,
  ancestorsOf,
  collectDirPaths,
  addToCollection,
  createCollection as createCollectionIn,
  cycleMode,
  deleteCollection as deleteCollectionIn,
  forgetPath,
  makeItem,
  removeFromCollection,
  renameCollection as renameCollectionIn,
  validateCollectionName,
  t,
  type Collection,
  type CollectionItem,
  type ViewMode,
  type ConflictResolution,
  type ConflictState,
  type NoteSummary,
  type ParsedNote,
  type TreeNode,
  type VaultError,
} from '@/core'
import type { MenuRequest } from '@/ui/ContextMenu'
import {
  createVault,
  toIndexRecord,
  toIndexRecords,
  type BacklinkRow,
  type NoteFile,
  type VaultApi,
  type VaultSettings,
  type VaultStatus,
  DEFAULT_SETTINGS,
} from '@/vault'
import {
  createUpdater,
  isUpdaterError,
  type UpdateInfo,
  type UpdaterApi,
} from '@/updater'

export type Phase = 'starting' | 'ready' | 'failed'

/**
 * Kde je aktualizace.
 *
 * `available` a `ready` jsou dva různé stavy schválně: mezi „něco vyšlo“
 * a „je to stažené a ověřené“ leží stahování, které může trvat i minutu,
 * a uživatel má vidět, co se děje.
 */
export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'up-to-date'
  | 'error'

export interface UpdateState {
  phase: UpdatePhase
  /** Verze, která běží. Prázdné, dokud se nezjistí. */
  currentVersion: string
  info: UpdateInfo | null
  downloaded: number
  total: number | null
  error: string | null
  /** True, když kontrolu spustil uživatel -- jen pak má smysl hlásit „nic nového“. */
  manual: boolean
  /** False v prohlížeči: tlačítko se pak vůbec neukáže. */
  supported: boolean
  /** Okno s nabídkou aktualizace je otevřené. */
  dialogOpen: boolean
}

const initialUpdate: UpdateState = {
  phase: 'idle',
  currentVersion: '',
  info: null,
  downloaded: 0,
  total: null,
  error: null,
  manual: false,
  supported: false,
  dialogOpen: false,
}

/** A single-field modal: new note, rename, new group. */
export interface PromptRequest {
  title: string
  label: string
  initialValue?: string
  placeholder?: string
  confirmLabel?: string
  /** Live validation; return a message to block submission. */
  validate?: (value: string) => string | null
  onSubmit: (value: string) => void | Promise<void>
}

/** A yes/no modal, for anything that cannot be undone with one click. */
export interface ConfirmRequest {
  title: string
  message: string
  confirmLabel: string
  destructive?: boolean
  onConfirm: () => void | Promise<void>
}

export interface Toast {
  id: number
  kind: 'success' | 'error' | 'info'
  message: string
  /** Optional one-click recovery, e.g. "Undo" or "Rebuild index". */
  action?: { label: string; run: () => void }
}

export interface EditorBuffer {
  path: string
  /** File text as loaded from disk. */
  baseText: string
  baseHash: string
  /** Current text in the textarea. */
  text: string
  dirty: boolean
  savedAt: number | null
  saving: boolean
  /**
   * True for a file opened through the explorer rather than from the vault.
   *
   * External files are edited and written verbatim: Reader_MJ never adds
   * frontmatter to a file it did not create, and there is no index row for it.
   */
  external: boolean
}

/** The right-hand file explorer. */
export interface ExplorerState {
  /** Absolute path of the opened folder, or null when none is open. */
  rootPath: string | null
  tree: TreeNode | null
  fileCount: number
  folderCount: number
  /** True when the scan hit a depth or size limit. */
  truncated: boolean
  /** Paths of expanded folders. */
  expanded: string[]
  /** Live filter over file and folder names. */
  filter: string
  loading: boolean
  error: string | null
  /** A single file opened on its own, with no folder around it. */
  loneFile: string | null
}

const emptyExplorer: ExplorerState = {
  rootPath: null,
  tree: null,
  fileCount: 0,
  folderCount: 0,
  truncated: false,
  expanded: [],
  filter: '',
  loading: false,
  error: null,
  loneFile: null,
}

export interface AppState {
  phase: Phase
  /** Fatal startup error; the app shows a recovery screen for this. */
  fatal: VaultError | null
  status: VaultStatus | null
  settings: VaultSettings

  notes: NoteSummary[]
  notesLoading: boolean
  query: string
  activeTag: string | null

  activePath: string | null
  editor: EditorBuffer | null
  parsed: ParsedNote | null
  backlinks: BacklinkRow[]

  conflict: ConflictState | null
  paletteOpen: boolean
  paletteMode: 'commands' | 'link'
  /** Raw Markdown, both panes, or just the rendered preview. */
  viewMode: ViewMode
  sidebarVisible: boolean
  /** Your groups of files, loaded from the vault. */
  collections: Collection[]
  /** The open right-click menu, if any. */
  menu: MenuRequest | null
  /** The open modal, if any. Kept in the store so any panel can raise one. */
  prompt: PromptRequest | null
  confirm: ConfirmRequest | null
  /** Collapsible sections of the workspace column. */
  notesSectionOpen: boolean
  filesSectionOpen: boolean
  /** True while the OS is dragging files over the window. */
  dropActive: boolean
  explorer: ExplorerState
  update: UpdateState
  busy: string | null
  toasts: Toast[]
}

const initialState: AppState = {
  phase: 'starting',
  fatal: null,
  status: null,
  settings: { ...DEFAULT_SETTINGS },
  notes: [],
  notesLoading: true,
  query: '',
  activeTag: null,
  activePath: null,
  editor: null,
  parsed: null,
  backlinks: [],
  conflict: null,
  paletteOpen: false,
  paletteMode: 'commands',
  viewMode: 'split',
  sidebarVisible: true,
  collections: [],
  menu: null,
  prompt: null,
  confirm: null,
  notesSectionOpen: true,
  filesSectionOpen: true,
  dropActive: false,
  explorer: emptyExplorer,
  update: initialUpdate,
  busy: null,
  toasts: [],
}

type Action =
  | { type: 'ready'; status: VaultStatus; settings: VaultSettings }
  | { type: 'fatal'; error: VaultError }
  | { type: 'status'; status: VaultStatus }
  | { type: 'settings'; settings: VaultSettings }
  | { type: 'notes'; notes: NoteSummary[] }
  | { type: 'notes-loading'; loading: boolean }
  | { type: 'query'; query: string }
  | { type: 'active-tag'; tag: string | null }
  | { type: 'open'; file: NoteFile; parsed: ParsedNote; external?: boolean }
  | { type: 'close' }
  | { type: 'explorer-loading' }
  | { type: 'explorer-error'; message: string }
  | {
      type: 'explorer-tree'
      rootPath: string
      tree: TreeNode
      fileCount: number
      folderCount: number
      truncated: boolean
      expanded: string[]
    }
  | { type: 'explorer-lone-file'; path: string }
  | { type: 'explorer-close' }
  | { type: 'explorer-toggle-dir'; path: string }
  | { type: 'explorer-set-expanded'; expanded: string[] }
  | { type: 'explorer-filter'; filter: string }
  | { type: 'toggle-notes-section' }
  | { type: 'toggle-files-section' }
  | { type: 'drop-active'; active: boolean }
  | { type: 'edit'; text: string }
  | { type: 'saving'; saving: boolean }
  | { type: 'saved'; hash: string; text: string; at: number }
  | { type: 'reparse'; parsed: ParsedNote }
  | { type: 'backlinks'; backlinks: BacklinkRow[] }
  | { type: 'conflict'; conflict: ConflictState | null }
  | { type: 'palette'; open: boolean; mode?: 'commands' | 'link' }
  | { type: 'view-mode'; mode: ViewMode }
  | { type: 'toggle-sidebar' }
  | { type: 'collections'; collections: Collection[] }
  | { type: 'menu'; menu: MenuRequest | null }
  | { type: 'prompt'; prompt: PromptRequest | null }
  | { type: 'confirm'; confirm: ConfirmRequest | null }
  | { type: 'update'; patch: Partial<UpdateState> }
  | { type: 'busy'; label: string | null }
  | { type: 'toast'; toast: Toast }
  | { type: 'dismiss-toast'; id: number }

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'ready':
      return { ...state, phase: 'ready', status: action.status, settings: action.settings, fatal: null }
    case 'fatal':
      return { ...state, phase: 'failed', fatal: action.error, notesLoading: false }
    case 'status':
      return { ...state, status: action.status }
    case 'settings':
      return { ...state, settings: action.settings }
    case 'notes':
      return { ...state, notes: action.notes, notesLoading: false }
    case 'notes-loading':
      return { ...state, notesLoading: action.loading }
    case 'query':
      return { ...state, query: action.query }
    case 'active-tag':
      return { ...state, activeTag: action.tag }
    case 'open':
      return {
        ...state,
        activePath: action.file.path,
        parsed: action.parsed,
        // A vault note keeps its backlinks; an external file has none.
        backlinks: action.external ? [] : state.backlinks,
        editor: {
          path: action.file.path,
          baseText: action.file.content,
          baseHash: action.file.hash,
          text: action.file.content,
          dirty: false,
          savedAt: null,
          saving: false,
          external: action.external ?? false,
        },
      }
    case 'close':
      return { ...state, activePath: null, editor: null, parsed: null, backlinks: [] }
    case 'edit': {
      if (!state.editor) return state
      return {
        ...state,
        editor: { ...state.editor, text: action.text, dirty: action.text !== state.editor.baseText },
      }
    }
    case 'saving':
      return state.editor ? { ...state, editor: { ...state.editor, saving: action.saving } } : state
    case 'saved': {
      if (!state.editor) return state
      return {
        ...state,
        editor: {
          ...state.editor,
          baseText: action.text,
          baseHash: action.hash,
          dirty: state.editor.text !== action.text,
          saving: false,
          savedAt: action.at,
        },
      }
    }
    case 'reparse':
      return { ...state, parsed: action.parsed }
    case 'backlinks':
      return { ...state, backlinks: action.backlinks }
    case 'conflict':
      return { ...state, conflict: action.conflict }
    case 'palette':
      return { ...state, paletteOpen: action.open, paletteMode: action.mode ?? state.paletteMode }
    case 'view-mode':
      return { ...state, viewMode: action.mode }
    case 'collections':
      return { ...state, collections: action.collections }
    case 'menu':
      return { ...state, menu: action.menu }
    case 'prompt':
      return { ...state, prompt: action.prompt }
    case 'confirm':
      return { ...state, confirm: action.confirm }
    case 'toggle-sidebar':
      return { ...state, sidebarVisible: !state.sidebarVisible }
    case 'toggle-notes-section':
      return { ...state, notesSectionOpen: !state.notesSectionOpen }
    case 'toggle-files-section':
      return { ...state, filesSectionOpen: !state.filesSectionOpen }
    case 'drop-active':
      return { ...state, dropActive: action.active }
    case 'explorer-loading':
      return { ...state, explorer: { ...state.explorer, loading: true, error: null } }
    case 'explorer-error':
      return { ...state, explorer: { ...state.explorer, loading: false, error: action.message } }
    case 'explorer-tree':
      return {
        ...state,
        filesSectionOpen: true,
        explorer: {
          ...state.explorer,
          rootPath: action.rootPath,
          tree: action.tree,
          fileCount: action.fileCount,
          folderCount: action.folderCount,
          truncated: action.truncated,
          expanded: action.expanded,
          loading: false,
          error: null,
          loneFile: null,
        },
      }
    case 'explorer-lone-file':
      return {
        ...state,
        filesSectionOpen: true,
        explorer: { ...emptyExplorer, loneFile: action.path },
      }
    case 'explorer-close':
      return { ...state, explorer: emptyExplorer }
    case 'explorer-toggle-dir': {
      const expanded = state.explorer.expanded.includes(action.path)
        ? state.explorer.expanded.filter((path) => path !== action.path)
        : [...state.explorer.expanded, action.path]
      return { ...state, explorer: { ...state.explorer, expanded } }
    }
    case 'explorer-set-expanded':
      return { ...state, explorer: { ...state.explorer, expanded: action.expanded } }
    case 'explorer-filter':
      return { ...state, explorer: { ...state.explorer, filter: action.filter } }
    case 'update':
      return { ...state, update: { ...state.update, ...action.patch } }
    case 'busy':
      return { ...state, busy: action.label }
    case 'toast':
      return { ...state, toasts: [...state.toasts.slice(-3), action.toast] }
    case 'dismiss-toast':
      return { ...state, toasts: state.toasts.filter((toast) => toast.id !== action.id) }
    default:
      return state
  }
}

export interface Actions {
  refresh(): Promise<void>
  setQuery(query: string): void
  setActiveTag(tag: string | null): void
  open(path: string): Promise<void>
  close(): void
  edit(text: string): void
  save(options?: { force?: boolean }): Promise<void>
  create(input?: { title?: string; folder?: string; body?: string; tags?: string[] }): Promise<string | null>
  rename(path: string, nextTitle: string): Promise<void>
  move(path: string, folder: string): Promise<void>
  remove(path: string): Promise<void>
  togglePin(path: string): Promise<void>
  toggleTaskAt(index: number): Promise<void>
  openDaily(): Promise<void>
  openOrCreateByTitle(title: string): Promise<void>
  insertAtCursor(text: string): void
  resolveConflict(resolution: ConflictResolution): Promise<void>
  rebuildIndex(): Promise<void>
  exportVault(): Promise<void>
  importFolder(): Promise<void>
  attachImage(file: File): Promise<void>
  setPalette(open: boolean, mode?: 'commands' | 'link'): void
  setViewMode(mode: ViewMode): void
  cycleViewMode(): void
  toggleSidebar(): void

  // --- collections ---------------------------------------------------------
  createCollection(name: string): Promise<void>
  renameCollection(id: string, name: string): Promise<void>
  removeCollection(id: string): Promise<void>
  /** The label defaults to the file name; a vault note passes its title. */
  addPathToCollection(
    id: string,
    path: string,
    external: boolean,
    label?: string,
  ): Promise<void>
  removePathFromCollection(id: string, path: string): Promise<void>
  openCollectionItem(item: CollectionItem): Promise<void>

  // --- the right-click menu -------------------------------------------------
  openMenu(request: MenuRequest): void
  closeMenu(): void
  deleteFile(path: string, external: boolean): Promise<void>

  // --- modals ---------------------------------------------------------------
  promptFor(request: PromptRequest): void
  confirmFor(request: ConfirmRequest): void
  dismissPrompt(): void
  dismissConfirm(): void

  /** Create a group and put this file in it, in one step. */
  createCollectionWith(name: string, path: string, external: boolean, label?: string): Promise<void>
  toggleNotesSection(): void
  toggleFilesSection(): void

  // --- the file explorer ---------------------------------------------------
  /** Pick a single Markdown file and open it. */
  openFileFromDisk(): Promise<void>
  /** Pick a folder and show it as a tree. */
  openFolderFromDisk(): Promise<void>
  /** Re-scan the open folder, picking up files added outside the app. */
  refreshTree(): Promise<void>
  /** Open a file the explorer is showing. */
  openFromTree(path: string): Promise<void>
  toggleTreeFolder(path: string): void
  expandAllFolders(): void
  collapseAllFolders(): void
  setTreeFilter(filter: string): void
  closeFolder(): void
  // --- aktualizace ----------------------------------------------------------
  /** Podívat se na GitHub. `manual` rozhoduje, jestli se hlásí i „nic nového“. */
  checkForUpdates(manual?: boolean): Promise<void>
  /** Stáhnout a nainstalovat nabídnutou verzi. Rozepsané změny se předtím uloží. */
  installUpdate(): Promise<void>
  /** Restartovat do nové verze. */
  restartForUpdate(): Promise<void>
  /** Zavřít okno aktualizace, nabídka zůstane platná. */
  dismissUpdate(): void

  toast(kind: Toast['kind'], message: string, action?: Toast['action']): void
  dismissToast(id: number): void
  reveal(): Promise<void>
  /** Reveal any path in the OS file manager. */
  revealPath(path: string): Promise<void>
  /** Registers the textarea so link insertion knows where the caret is. */
  bindEditorElement(element: HTMLTextAreaElement | null): void
}

interface StoreValue {
  state: AppState
  actions: Actions
  vault: VaultApi
  updater: UpdaterApi
}

const StoreContext = createContext<StoreValue | null>(null)

let toastId = 0

export function StoreProvider({
  children,
  vault,
  updater,
}: {
  children: ReactNode
  vault?: VaultApi
  updater?: UpdaterApi
}) {
  const vaultRef = useRef<VaultApi>(vault ?? createVault())
  const updaterRef = useRef<UpdaterApi>(updater ?? createUpdater())
  const [state, dispatch] = useReducer(reducer, initialState)

  const stateRef = useRef(state)
  stateRef.current = state

  const editorElement = useRef<HTMLTextAreaElement | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Every pending toast auto-dismiss, so none of them outlive the provider. */
  const toastTimers = useRef(new Set<ReturnType<typeof setTimeout>>())

  const toast = useCallback((kind: Toast['kind'], message: string, action?: Toast['action']) => {
    const id = ++toastId
    dispatch({ type: 'toast', toast: { id, kind, message, ...(action ? { action } : {}) } })
    // Errors stay until dismissed; everything else fades on its own.
    if (kind === 'error') return

    const timer = setTimeout(() => {
      toastTimers.current.delete(timer)
      dispatch({ type: 'dismiss-toast', id })
    }, 4000)
    toastTimers.current.add(timer)
  }, [])

  // Nothing scheduled may fire after the provider goes away.
  useEffect(() => {
    const timers = toastTimers.current
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      if (searchTimer.current) clearTimeout(searchTimer.current)
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
    }
  }, [])

  const reportError = useCallback(
    (error: unknown, fallback: string) => {
      const normalised: VaultError = isVaultError(error)
        ? error
        : { kind: 'io', message: error instanceof Error ? error.message : fallback }
      if (normalised.kind === 'conflict' && normalised.conflict) {
        dispatch({ type: 'conflict', conflict: normalised.conflict })
        return
      }
      toast('error', normalised.message || fallback)
    },
    [toast],
  )

  // -- reading ---------------------------------------------------------------

  const runSearch = useCallback(async (query: string, tag: string | null) => {
    const combined = [tag ? `tag:${tag}` : '', query].filter(Boolean).join(' ')
    dispatch({ type: 'notes-loading', loading: true })
    try {
      const notes = combined.trim()
        ? await vaultRef.current.search(combined)
        : await vaultRef.current.listNotes()
      dispatch({ type: 'notes', notes })
    } catch (error) {
      dispatch({ type: 'notes', notes: [] })
      reportError(error, t.errors.search)
    }
  }, [reportError])

  const refresh = useCallback(async () => {
    const { query, activeTag } = stateRef.current
    await runSearch(query, activeTag)
    try {
      dispatch({ type: 'status', status: await vaultRef.current.status() })
    } catch {
      // A status refresh failing is not worth interrupting the user.
    }
  }, [runSearch])

  const loadBacklinks = useCallback(async (path: string) => {
    try {
      dispatch({ type: 'backlinks', backlinks: await vaultRef.current.backlinks(path) })
    } catch {
      dispatch({ type: 'backlinks', backlinks: [] })
    }
  }, [])

  const open = useCallback(
    async (path: string) => {
      try {
        const file = await vaultRef.current.readNote(path)
        dispatch({ type: 'open', file, parsed: parseNote(file.content, { path }) })
        void loadBacklinks(path)
      } catch (error) {
        reportError(error, t.errors.open(path))
      }
    },
    [loadBacklinks, reportError],
  )

  // -- writing ---------------------------------------------------------------

  const save = useCallback(
    async (options: { force?: boolean } = {}) => {
      const editor = stateRef.current.editor
      if (!editor) return
      if (!editor.dirty && !options.force) return

      // An external file is written exactly as it appears in the editor.
      // Reader_MJ does not own it, so it does not get frontmatter, an id or an
      // index row -- only the same "did this change underneath me?" guard.
      if (editor.external) {
        dispatch({ type: 'saving', saving: true })
        try {
          const result = await vaultRef.current.writeExternalFile({
            path: editor.path,
            content: editor.text,
            expectedHash: options.force ? null : editor.baseHash,
          })
          dispatch({ type: 'saved', hash: result.hash, text: editor.text, at: Date.now() })
          dispatch({ type: 'reparse', parsed: parseNote(editor.text, { path: editor.path }) })
        } catch (error) {
          dispatch({ type: 'saving', saving: false })
          reportError(error, t.errors.saveFile)
        }
        return
      }

      const parsed = parseNote(editor.text, { path: editor.path })
      const refreshed = applyBodyEdit(parsed, parsed.body)
      const content = serializeNoteFile(refreshed)

      dispatch({ type: 'saving', saving: true })
      try {
        const result = await vaultRef.current.writeNote({
          path: editor.path,
          content,
          expectedHash: options.force ? null : editor.baseHash,
          record: toIndexRecord(editor.path, content, refreshed),
        })
        dispatch({ type: 'saved', hash: result.hash, text: content, at: Date.now() })
        dispatch({ type: 'reparse', parsed: refreshed })
        void refresh()
        void loadBacklinks(editor.path)
      } catch (error) {
        dispatch({ type: 'saving', saving: false })
        reportError(error, t.errors.save)
      }
    },
    [loadBacklinks, refresh, reportError],
  )

  const edit = useCallback(
    (text: string) => {
      dispatch({ type: 'edit', text })
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => void save(), 600)
    },
    [save],
  )

  const create = useCallback(
    async (input: { title?: string; folder?: string; body?: string; tags?: string[] } = {}) => {
      const requested = (input.title ?? '').trim() || 'Bez názvu'
      const validation = validateNoteName(requested)
      if (!validation.ok) {
        toast('error', validation.message ?? t.errors.nameUnusable)
        return null
      }
      const existing = new Set(stateRef.current.notes.map((note) => note.path))
      let candidatePaths = existing
      try {
        candidatePaths = new Set((await vaultRef.current.listNotes()).map((note) => note.path))
      } catch {
        // Fall back to what we already have in state.
      }
      const path = uniquePath(joinNotePath(input.folder ?? '', validation.value), candidatePaths)
      const content = createNoteFile({
        title: validation.value,
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.tags ? { tags: input.tags } : {}),
      })

      try {
        await vaultRef.current.createNote({ path, content, record: toIndexRecord(path, content) })
        await open(path)
        void refresh()
        if (validation.message) toast('info', validation.message)
        else toast('success', t.toast.created(path))
        return path
      } catch (error) {
        reportError(error, t.errors.create)
        return null
      }
    },
    [open, refresh, reportError, toast],
  )

  /**
   * Rewrite every inbound `[[link]]` that pointed at `fromPath` so it points at
   * `toTarget`. Runs before the file itself moves, so a failure leaves the
   * vault consistent.
   */
  const rewriteInboundLinks = useCallback(
    async (fromPath: string, oldTitle: string, toTarget: string) => {
      const files = await vaultRef.current.readAllNotes()
      const notes = files.map((file) => ({
        path: file.path,
        title: parseNote(file.content, { path: file.path }).frontmatter.title,
        file,
      }))
      const index = buildLinkIndex(notes)

      const oldKeys = new Set(
        [fromPath, fromPath.split('/').pop() ?? '', oldTitle].map(linkKey).filter(Boolean),
      )
      const matches = (target: string) =>
        oldKeys.has(linkKey(target)) || resolveLink(index, target) === fromPath

      let updated = 0
      for (const note of notes) {
        if (note.path === fromPath) continue
        const parsed = parseNote(note.file.content, { path: note.path })
        const { body, changed } = rewriteLinks(parsed.body, matches, toTarget)
        if (changed === 0) continue
        const next = applyBodyEdit(parsed, body)
        const content = serializeNoteFile(next)
        await vaultRef.current.writeNote({
          path: note.path,
          content,
          expectedHash: note.file.hash,
          record: toIndexRecord(note.path, content, next),
        })
        updated += 1
      }
      return updated
    },
    [],
  )

  const rename = useCallback(
    async (path: string, nextTitle: string) => {
      const validation = validateNoteName(nextTitle)
      if (!validation.ok) {
        toast('error', validation.message ?? t.errors.nameUnusable)
        return
      }

      dispatch({ type: 'busy', label: 'Přejmenovávám' })
      try {
        const file = await vaultRef.current.readNote(path)
        const parsed = parseNote(file.content, { path })
        const oldTitle = parsed.frontmatter.title

        const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
        const taken = new Set((await vaultRef.current.listNotes()).map((note) => note.path))
        taken.delete(path)
        const target = uniquePath(joinNotePath(folder, validation.value), taken)
        const newTarget = target.replace(/\.md$/i, '')

        const updatedLinks = await rewriteInboundLinks(path, oldTitle, newTarget)

        // Write the retitled content first, then move the file.
        const retitled = retitleNote(parsed, validation.value)
        const content = serializeNoteFile(retitled)
        await vaultRef.current.writeNote({
          path,
          content,
          expectedHash: file.hash,
          record: toIndexRecord(path, content, retitled),
        })
        if (target !== path) await vaultRef.current.renameNote(path, target)

        await open(target)
        await refresh()
        toast(
          'success',
          updatedLinks > 0
            ? t.toast.renamedWithLinks(validation.value, updatedLinks)
            : t.toast.renamed(validation.value),
        )
      } catch (error) {
        reportError(error, t.errors.rename)
      } finally {
        dispatch({ type: 'busy', label: null })
      }
    },
    [open, refresh, reportError, rewriteInboundLinks, toast],
  )

  const move = useCallback(
    async (path: string, folder: string) => {
      const cleanFolder = safeFolderPath(folder)
      const base = path.split('/').pop() ?? path
      const target = cleanFolder ? `${cleanFolder}/${base}` : base
      if (target === path) return

      dispatch({ type: 'busy', label: 'Přesouvám' })
      try {
        const file = await vaultRef.current.readNote(path)
        const oldTitle = parseNote(file.content, { path }).frontmatter.title
        const taken = new Set((await vaultRef.current.listNotes()).map((note) => note.path))
        taken.delete(path)
        const unique = uniquePath(target, taken)

        await rewriteInboundLinks(path, oldTitle, unique.replace(/\.md$/i, ''))
        await vaultRef.current.renameNote(path, unique)
        await open(unique)
        await refresh()
        toast('success', cleanFolder ? t.toast.moved(cleanFolder) : t.toast.movedToRoot)
      } catch (error) {
        reportError(error, t.errors.move)
      } finally {
        dispatch({ type: 'busy', label: null })
      }
    },
    [open, refresh, reportError, rewriteInboundLinks, toast],
  )

  const remove = useCallback(
    async (path: string) => {
      try {
        const file = await vaultRef.current.readNote(path)
        await vaultRef.current.deleteNote(path)
        if (stateRef.current.activePath === path) dispatch({ type: 'close' })
        await refresh()
        toast('info', t.toast.deleted(path), {
          label: t.common.undo,
          run: () => {
            void (async () => {
              try {
                await vaultRef.current.createNote({
                  path,
                  content: file.content,
                  record: toIndexRecord(path, file.content),
                })
                await refresh()
                await open(path)
                toast('success', t.toast.restored)
              } catch (error) {
                reportError(error, t.errors.restore)
              }
            })()
          },
        })
      } catch (error) {
        reportError(error, t.errors.remove)
      }
    },
    [open, refresh, reportError, toast],
  )

  const togglePin = useCallback(
    async (path: string) => {
      try {
        const file = await vaultRef.current.readNote(path)
        const parsed = parseNote(file.content, { path })
        const next = setPinned(parsed, !parsed.frontmatter.pinned)
        const content = serializeNoteFile(next)
        await vaultRef.current.writeNote({
          path,
          content,
          expectedHash: file.hash,
          record: toIndexRecord(path, content, next),
        })
        if (stateRef.current.activePath === path) {
          dispatch({ type: 'open', file: { ...file, content, hash: hashText(content) }, parsed: next })
        }
        await refresh()
        toast('success', next.frontmatter.pinned ? t.toast.pinned : t.toast.unpinned)
      } catch (error) {
        reportError(error, t.errors.pin)
      }
    },
    [refresh, reportError, toast],
  )

  const toggleTaskAt = useCallback(
    async (index: number) => {
      const editor = stateRef.current.editor
      if (!editor) return

      // An external file is edited in place: flipping a checkbox must not
      // rewrite the rest of the file.
      if (editor.external) {
        const text = toggleTask(editor.text, index)
        if (text === editor.text) return
        dispatch({ type: 'edit', text })
        dispatch({ type: 'reparse', parsed: parseNote(text, { path: editor.path }) })
        if (saveTimer.current) clearTimeout(saveTimer.current)
        saveTimer.current = setTimeout(() => void save(), 200)
        return
      }

      const parsed = parseNote(editor.text, { path: editor.path })
      const body = toggleTask(parsed.body, index)
      if (body === parsed.body) return
      const next = applyBodyEdit(parsed, body)
      const content = serializeNoteFile(next)
      dispatch({ type: 'edit', text: content })
      dispatch({ type: 'reparse', parsed: next })
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => void save(), 200)
    },
    [save],
  )

  const openOrCreateByTitle = useCallback(
    async (title: string) => {
      try {
        const notes = await vaultRef.current.listNotes()
        const index = buildLinkIndex(notes.map((note) => ({ path: note.path, title: note.title })))
        const existing = resolveLink(index, title)
        if (existing) {
          await open(existing)
          return
        }
        await create({ title })
      } catch (error) {
        reportError(error, t.errors.openLink)
      }
    },
    [create, open, reportError],
  )

  const openDaily = useCallback(async () => {
    const folder = stateRef.current.settings.dailyFolder
    const path = dailyNotePath(new Date(), folder)
    try {
      await vaultRef.current.readNote(path)
      await open(path)
      return
    } catch {
      // Not there yet: create it below.
    }
    try {
      const content = dailyNoteTemplate(new Date())
      await vaultRef.current.createNote({ path, content, record: toIndexRecord(path, content) })
      await open(path)
      await refresh()
      toast('success', t.toast.dailyCreated)
    } catch (error) {
      reportError(error, t.errors.openDaily)
    }
  }, [open, refresh, reportError, toast])

  /**
   * Insert text at the caret.
   *
   * The textarea holds the note *body*, while the buffer holds the whole file
   * including frontmatter, so the caret offset is translated through a parse
   * rather than applied to `editor.text` directly.
   */
  const insertAtCursor = useCallback(
    (text: string) => {
      const element = editorElement.current
      const editor = stateRef.current.editor
      if (!editor) return

      // For an external file the textarea holds the whole file, so the caret
      // offset applies to it directly; for a vault note it applies to the body.
      if (editor.external) {
        const start = element ? element.selectionStart : editor.text.length
        const end = element ? element.selectionEnd : editor.text.length
        edit(editor.text.slice(0, start) + text + editor.text.slice(end))
        if (!element) return
        requestAnimationFrame(() => {
          element.focus()
          element.setSelectionRange(start + text.length, start + text.length)
        })
        return
      }

      const parsed = parseNote(editor.text, { path: editor.path })
      const start = element ? element.selectionStart : parsed.body.length
      const end = element ? element.selectionEnd : parsed.body.length
      const body = parsed.body.slice(0, start) + text + parsed.body.slice(end)

      edit(serializeNoteFile(applyBodyEdit(parsed, body)))
      if (!element) return
      requestAnimationFrame(() => {
        element.focus()
        element.setSelectionRange(start + text.length, start + text.length)
      })
    },
    [edit],
  )

  const resolveConflict = useCallback(
    async (resolution: ConflictResolution) => {
      const conflict = stateRef.current.conflict
      if (!conflict) return
      try {
        if (resolution === 'use-disk') {
          dispatch({ type: 'conflict', conflict: null })
          await open(conflict.path)
          toast('info', t.toast.loadedFromDisk)
          return
        }

        if (resolution === 'keep-both') {
          const parsed = parseNote(conflict.local, { path: conflict.path })
          const folder = conflict.path.includes('/')
            ? conflict.path.slice(0, conflict.path.lastIndexOf('/'))
            : ''
          const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
          const taken = new Set((await vaultRef.current.listNotes()).map((note) => note.path))
          const copyPath = uniquePath(
            joinNotePath(folder, safeFileName(`${titleFromPath(conflict.path)} (moje kopie ${stamp})`)),
            taken,
          )
          const copyContent = serializeNoteFile(parsed)
          await vaultRef.current.createNote({
            path: copyPath,
            content: copyContent,
            record: toIndexRecord(copyPath, copyContent),
          })
          dispatch({ type: 'conflict', conflict: null })
          await refresh()
          await open(copyPath)
          toast('success', t.toast.keptBoth(copyPath))
          return
        }

        // keep-local: overwrite, but only after the user has seen the diff.
        const parsed = parseNote(conflict.local, { path: conflict.path })
        const next = applyBodyEdit(parsed, parsed.body)
        const content = serializeNoteFile(next)
        const result = await vaultRef.current.writeNote({
          path: conflict.path,
          content,
          expectedHash: null,
          record: toIndexRecord(conflict.path, content, next),
        })
        dispatch({ type: 'conflict', conflict: null })
        dispatch({ type: 'saved', hash: result.hash, text: content, at: Date.now() })
        await refresh()
        toast('success', t.toast.keptMine)
      } catch (error) {
        reportError(error, t.errors.conflict)
      }
    },
    [open, refresh, reportError, toast],
  )

  const rebuildIndex = useCallback(async () => {
    dispatch({ type: 'busy', label: 'Přestavuji rejstřík' })
    try {
      const files = await vaultRef.current.readAllNotes()
      const result = await vaultRef.current.rebuildIndex(toIndexRecords(files))
      await refresh()
      const ms = Math.max(1, Math.round(result.durationMs))
      toast(
        'success',
        result.fullTextSearch ? t.toast.indexed(result.notes, ms) : t.toast.indexedNoFts(result.notes, ms),
      )
    } catch (error) {
      reportError(error, t.errors.rebuild)
    } finally {
      dispatch({ type: 'busy', label: null })
    }
  }, [refresh, reportError, toast])

  const exportVault = useCallback(async () => {
    dispatch({ type: 'busy', label: 'Exportuji' })
    try {
      const destination = await vaultRef.current.pickFolder('Vyber složku pro export')
      const result = await vaultRef.current.exportVault(destination ?? undefined)
      toast('success', t.toast.exported(result.files, result.destination))
    } catch (error) {
      reportError(error, t.errors.export)
    } finally {
      dispatch({ type: 'busy', label: null })
    }
  }, [reportError, toast])

  const importFolder = useCallback(async () => {
    dispatch({ type: 'busy', label: 'Importuji' })
    try {
      const source = await vaultRef.current.pickFolder('Vyber složku se soubory .md')
      if (!source) {
        dispatch({ type: 'busy', label: null })
        return
      }
      const result = await vaultRef.current.importFolder(source)
      await rebuildIndex()
      toast('success', t.toast.imported(result.imported, result.skipped))
    } catch (error) {
      reportError(error, t.errors.import)
    } finally {
      dispatch({ type: 'busy', label: null })
    }
  }, [rebuildIndex, reportError, toast])

  const attachImage = useCallback(
    async (file: File) => {
      // Attachments live in the vault's `attachments/` folder. Copying a file
      // there and linking it from someone else's folder would produce a link
      // that breaks the moment that folder moves, so refuse it plainly.
      if (stateRef.current.editor?.external) {
        toast('error', t.toast.attachmentsVaultOnly)
        return
      }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const { path } = await vaultRef.current.importAttachment({ name: file.name, bytes })
        insertAtCursor(`\n![${file.name.replace(/[[\]]/g, '')}](${path})\n`)
        toast('success', t.toast.attached(path))
      } catch (error) {
        reportError(error, t.errors.attach)
      }
    },
    [insertAtCursor, reportError, toast],
  )

  const reveal = useCallback(async () => {
    const path = stateRef.current.activePath ?? ''
    await vaultRef.current.reveal(path)
  }, [])

  const revealPath = useCallback(async (path: string) => {
    await vaultRef.current.reveal(path)
  }, [])

  // -- the file explorer -----------------------------------------------------

  /** Open a file that lives outside the vault. */
  const openFromTree = useCallback(
    async (path: string) => {
      try {
        const file = await vaultRef.current.readExternalFile(path)
        dispatch({
          type: 'open',
          file,
          parsed: parseNote(file.content, { path }),
          external: true,
        })
        // Reveal it in the tree, so clicking a search result or following a
        // link never leaves the selection hidden inside a collapsed folder.
        const explorer = stateRef.current.explorer
        const needed = ancestorsOf(explorer.tree, path)
        if (needed.length > 0) {
          const expanded = new Set([...explorer.expanded, ...needed])
          dispatch({ type: 'explorer-set-expanded', expanded: [...expanded] })
        }
      } catch (error) {
        reportError(error, t.errors.open(path))
      }
    },
    [reportError],
  )

  const loadTree = useCallback(
    async (rootPath: string, keepExpanded: string[] = []) => {
      dispatch({ type: 'explorer-loading' })
      try {
        const folder = await vaultRef.current.readFolderTree(rootPath)
        dispatch({
          type: 'explorer-tree',
          rootPath,
          tree: folder.root,
          fileCount: folder.fileCount,
          folderCount: folder.folderCount,
          truncated: folder.truncated,
          expanded: keepExpanded,
        })
        if (folder.fileCount === 0) {
          toast('info', t.toast.emptyFolder)
        } else if (folder.truncated) {
          toast('info', t.toast.truncatedScan(folder.fileCount))
        }
      } catch (error) {
        const message = isVaultError(error) ? error.message : t.errors.readFolder(rootPath)
        dispatch({ type: 'explorer-error', message })
      }
    },
    [toast],
  )

  const openFileFromDisk = useCallback(async () => {
    try {
      const path = await vaultRef.current.openFileDialog()
      if (!path) return
      dispatch({ type: 'explorer-lone-file', path })
      await openFromTree(path)
    } catch (error) {
      reportError(error, t.errors.openFile)
    }
  }, [openFromTree, reportError])

  const openFolderFromDisk = useCallback(async () => {
    try {
      const path = await vaultRef.current.openFolderDialog()
      if (!path) return
      await loadTree(path)
    } catch (error) {
      reportError(error, t.errors.openFolder)
    }
  }, [loadTree, reportError])

  const refreshTree = useCallback(async () => {
    const { rootPath, expanded } = stateRef.current.explorer
    if (!rootPath) return
    await loadTree(rootPath, expanded)
  }, [loadTree])

  const expandAllFolders = useCallback(() => {
    const tree = stateRef.current.explorer.tree
    dispatch({ type: 'explorer-set-expanded', expanded: collectDirPaths(tree) })
  }, [])

  // -- collections -----------------------------------------------------------

  /**
   * Persist a new collection list and show it.
   *
   * Saving also re-grants access to every linked file on the Rust side, which
   * is what lets a group of files scattered across the machine still open
   * tomorrow.
   */
  const commitCollections = useCallback(
    async (next: Collection[]) => {
      dispatch({ type: 'collections', collections: next })
      try {
        const saved = await vaultRef.current.saveCollections(next)
        dispatch({ type: 'collections', collections: saved })
      } catch (error) {
        // Put the old list back rather than leaving the screen lying.
        dispatch({ type: 'collections', collections: stateRef.current.collections })
        reportError(error, t.errors.saveGroups)
      }
    },
    [reportError],
  )

  const createCollection = useCallback(
    async (name: string) => {
      const check = validateCollectionName(name, stateRef.current.collections)
      if (!check.ok) {
        toast('error', check.message ?? t.errors.nameUnusable)
        return
      }
      await commitCollections(createCollectionIn(stateRef.current.collections, check.value))
      toast('success', t.toast.groupCreated(check.value))
    },
    [commitCollections, toast],
  )

  /** Create a group and drop a file into it without a second round trip. */
  const createCollectionWith = useCallback(
    async (name: string, path: string, external: boolean, label?: string) => {
      const check = validateCollectionName(name, stateRef.current.collections)
      if (!check.ok) {
        toast('error', check.message ?? t.errors.nameUnusable)
        return
      }
      const withGroup = createCollectionIn(stateRef.current.collections, check.value)
      const created = withGroup[withGroup.length - 1]
      if (!created) return
      await commitCollections(addToCollection(withGroup, created.id, makeItem(path, external, label)))
      toast('success', t.toast.groupCreatedWithFile(check.value))
    },
    [commitCollections, toast],
  )

  const renameCollection = useCallback(
    async (id: string, name: string) => {
      const others = stateRef.current.collections.filter((collection) => collection.id !== id)
      const check = validateCollectionName(name, others)
      if (!check.ok) {
        toast('error', check.message ?? t.errors.nameUnusable)
        return
      }
      await commitCollections(renameCollectionIn(stateRef.current.collections, id, check.value))
    },
    [commitCollections, toast],
  )

  const removeCollection = useCallback(
    async (id: string) => {
      const gone = stateRef.current.collections.find((collection) => collection.id === id)
      await commitCollections(deleteCollectionIn(stateRef.current.collections, id))
      if (gone) {
        toast('info', t.toast.groupDeleted(gone.name))
      }
    },
    [commitCollections, toast],
  )

  const addPathToCollection = useCallback(
    async (id: string, path: string, external: boolean, label?: string) => {
      const collection = stateRef.current.collections.find((entry) => entry.id === id)
      if (!collection) return
      const next = addToCollection(stateRef.current.collections, id, makeItem(path, external, label))
      const added = (next.find((entry) => entry.id === id)?.items.length ?? 0) > collection.items.length
      await commitCollections(next)
      toast('success', added ? t.toast.addedToGroup(collection.name) : t.toast.alreadyInGroup(collection.name))
    },
    [commitCollections, toast],
  )

  const removePathFromCollection = useCallback(
    async (id: string, path: string) => {
      await commitCollections(removeFromCollection(stateRef.current.collections, id, path))
    },
    [commitCollections],
  )

  const openCollectionItem = useCallback(
    async (item: CollectionItem) => {
      if (item.external) {
        await openFromTree(item.path)
        return
      }
      await open(item.path)
    },
    [open, openFromTree],
  )

  /**
   * Delete a file, from the vault or from anywhere else.
   *
   * The file also leaves every group it was in -- a link to a file that no
   * longer exists is worse than no link.
   */
  const deleteFile = useCallback(
    async (path: string, external: boolean) => {
      try {
        if (external) await vaultRef.current.deleteExternalFile(path)
        else await vaultRef.current.deleteNote(path)

        if (stateRef.current.activePath === path) dispatch({ type: 'close' })

        const pruned = forgetPath(stateRef.current.collections, path)
        if (JSON.stringify(pruned) !== JSON.stringify(stateRef.current.collections)) {
          await commitCollections(pruned)
        }

        await refresh()
        if (external && stateRef.current.explorer.rootPath) await refreshTree()
        toast('info', t.toast.deleted(path.split(/[\\/]/).pop() ?? path))
      } catch (error) {
        reportError(error, t.errors.deleteFile)
      }
    },
    [commitCollections, refresh, refreshTree, reportError, toast],
  )

  /**
   * Files or folders dropped onto the window from the OS.
   *
   * A folder wins over a file: dropping a folder with one of its files in the
   * same gesture should give you the tree, with that file open.
   */
  const acceptDrop = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return
      try {
        const dropped = await vaultRef.current.acceptDroppedPaths(paths)

        if (dropped.folder) {
          await loadTree(dropped.folder)
          if (dropped.file) await openFromTree(dropped.file)
          return
        }
        if (dropped.file) {
          dispatch({ type: 'explorer-lone-file', path: dropped.file })
          await openFromTree(dropped.file)
          return
        }
        toast('error', dropped.ignored === 1 ? t.toast.notMarkdown : t.toast.noneUsable(dropped.ignored))
      } catch (error) {
        reportError(error, t.errors.drop)
      }
    },
    [loadTree, openFromTree, reportError, toast],
  )

  // -- aktualizace ------------------------------------------------------------

  const failUpdate = useCallback((error: unknown, fallback: string): string => {
    const message = isUpdaterError(error)
      ? error.message
      : error instanceof Error
        ? error.message
        : fallback
    dispatch({ type: 'update', patch: { phase: 'error', error: message } })
    return message
  }, [])

  /**
   * Stáhnout nabídnutou verzi.
   *
   * Volá se automaticky po startu i z okna aktualizace. Instalace v tom není
   * schválně -- ta zavře aplikaci, takže si o ni musí říct uživatel.
   */
  const downloadUpdate = useCallback(async (offered?: UpdateInfo | null): Promise<boolean> => {
    const updater = updaterRef.current
    // Nabídka se předává parametrem: `dispatch` se do `stateRef` promítne až
    // po překreslení, takže hned po `check()` by tu ještě nebyla.
    const info = offered ?? stateRef.current.update.info
    if (!info) return false

    dispatch({
      type: 'update',
      patch: { phase: 'downloading', downloaded: 0, total: null, error: null },
    })
    try {
      await updater.download(({ downloaded, total }) => {
        dispatch({ type: 'update', patch: { downloaded, total } })
      })
      dispatch({ type: 'update', patch: { phase: 'ready' } })
      return true
    } catch (error) {
      failUpdate(error, t.update.errorInstall)
      return false
    }
  }, [failUpdate])

  const checkForUpdates = useCallback(
    async (manual = false) => {
      const updater = updaterRef.current
      if (!updater.available) {
        if (manual) toast('info', t.update.unavailable)
        return
      }

      const phase = stateRef.current.update.phase
      // Druhá kontrola během stahování by zahodila balíček, který se právě
      // stahuje. Ruční kliknutí v takové chvíli jen otevře okno.
      if (phase === 'checking' || phase === 'downloading') {
        if (manual) dispatch({ type: 'update', patch: { dialogOpen: true } })
        return
      }
      if (phase === 'ready' && manual) {
        dispatch({ type: 'update', patch: { dialogOpen: true } })
        return
      }

      dispatch({
        type: 'update',
        patch: { phase: 'checking', manual, error: null, dialogOpen: manual },
      })

      try {
        const info = await updater.check()
        if (!info) {
          const version =
            stateRef.current.update.currentVersion || (await updater.currentVersion())
          dispatch({
            type: 'update',
            patch: {
              phase: 'up-to-date',
              info: null,
              currentVersion: version,
              dialogOpen: false,
            },
          })
          if (manual) toast('success', t.update.upToDate(version))
          return
        }

        dispatch({
          type: 'update',
          patch: {
            phase: 'available',
            info,
            currentVersion: info.currentVersion,
            downloaded: 0,
            total: null,
            error: null,
            dialogOpen: true,
          },
        })
        // Stahujeme rovnou: než si uživatel přečte, co je nového, je balíček
        // většinou hotový a zbývá jediné kliknutí.
        await downloadUpdate(info)
      } catch (error) {
        const message = failUpdate(error, t.update.errorCheck)
        if (manual) {
          dispatch({ type: 'update', patch: { dialogOpen: true } })
        } else {
          // Kontrola po startu nesmí uživateli skočit do cesty oknem. Bez sítě
          // se nic neděje a aplikace funguje dál.
          dispatch({ type: 'update', patch: { dialogOpen: false } })
          console.warn(`reader_mj: kontrola aktualizací selhala: ${message}`)
        }
      }
    },
    [downloadUpdate, failUpdate, toast],
  )

  const installUpdate = useCallback(async () => {
    const updater = updaterRef.current
    if (stateRef.current.update.phase !== 'ready') {
      // Uživatel klikl dřív, než se dostahovalo: dokonči stahování a pak instaluj.
      const ok = await downloadUpdate()
      if (!ok) return
    }

    // Instalátor aplikaci zavře, takže rozepsanou poznámku uložíme teď.
    if (stateRef.current.editor?.dirty) {
      try {
        await save()
      } catch {
        /* uložení si stěžuje samo; aktualizaci to nemá blokovat */
      }
    }

    dispatch({ type: 'update', patch: { phase: 'downloading', error: null } })
    try {
      await updater.install()
      dispatch({ type: 'update', patch: { phase: 'ready' } })
      await updater.relaunch()
    } catch (error) {
      failUpdate(error, t.update.errorInstall)
    }
  }, [downloadUpdate, failUpdate, save])

  const restartForUpdate = useCallback(async () => {
    try {
      await updaterRef.current.relaunch()
    } catch (error) {
      failUpdate(error, t.update.errorInstall)
    }
  }, [failUpdate])

  const dismissUpdate = useCallback(() => {
    dispatch({ type: 'update', patch: { dialogOpen: false } })
  }, [])

  // -- lifecycle -------------------------------------------------------------

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const status = await vaultRef.current.status()
        const settings = await vaultRef.current.loadSettings()
        if (cancelled) return
        dispatch({ type: 'ready', status, settings })
        if (status.warning) toast('info', status.warning)
        const notes = await vaultRef.current.listNotes()
        if (cancelled) return
        dispatch({ type: 'notes', notes })

        // Groups come last: they are a convenience, and a failure here must
        // not stop the vault from opening.
        try {
          const collections = await vaultRef.current.loadCollections()
          if (!cancelled) dispatch({ type: 'collections', collections })
        } catch {
          /* leave the list empty */
        }
        const first = notes[0]
        if (first) void open(first.path)
      } catch (error) {
        if (cancelled) return
        dispatch({
          type: 'fatal',
          error: isVaultError(error)
            ? error
            : { kind: 'io', message: t.errors.openVault },
        })
      }
    })()
    return () => {
      cancelled = true
    }
    // Deliberately runs once: this is app start-up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Debounced search whenever the query or the tag filter changes.
  useEffect(() => {
    if (state.phase !== 'ready') return
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => void runSearch(state.query, state.activeTag), 120)
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    }
  }, [state.query, state.activeTag, state.phase, runSearch])

  // External file changes: reload silently, or raise a conflict.
  useEffect(() => {
    return vaultRef.current.onExternalChange((change) => {
      const current = stateRef.current
      void refresh()
      if (!current.editor || current.editor.path !== change.path) return

      if (change.kind === 'removed') {
        toast('error', t.toast.deletedOutside(change.path))
        return
      }

      const decision = decideExternalChange({
        baseHash: current.editor.baseHash,
        diskHash: change.hash ?? '',
        dirty: current.editor.dirty,
        localHash: hashText(current.editor.text),
      })

      if (decision === 'ignore') return
      if (decision === 'reload') {
        void open(change.path)
        return
      }

      void (async () => {
        try {
          const file = await vaultRef.current.readNote(change.path)
          dispatch({
            type: 'conflict',
            conflict: {
              path: change.path,
              local: current.editor!.text,
              disk: file.content,
              baseHash: current.editor!.baseHash,
              diskHash: file.hash,
              detectedAt: Date.now(),
            },
          })
        } catch {
          toast('error', t.toast.changedButUnreadable(change.path))
        }
      })()
    })
  }, [open, refresh, toast])

  /**
   * Kontrola aktualizací po startu.
   *
   * Až po otevření trezoru a s malým odstupem: prvních pár vteřin patří
   * poznámkám, ne síti. Selhání se nikam nehlásí -- bez internetu aplikace
   * funguje úplně stejně.
   */
  useEffect(() => {
    let cancelled = false
    const updater = updaterRef.current

    void (async () => {
      const version = await updater.currentVersion().catch(() => '')
      if (cancelled) return
      dispatch({
        type: 'update',
        patch: { supported: updater.available, currentVersion: version },
      })
      if (!updater.available) return
      if (!(await updater.autoCheckEnabled().catch(() => false))) return
      if (cancelled) return
      void checkForUpdates(false)
    })()

    return () => {
      cancelled = true
    }
    // Jednou za běh aplikace, stejně jako zbytek startu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Files dragged from the OS onto the window.
  useEffect(() => {
    return vaultRef.current.onFileDrop(({ hovering, paths }) => {
      dispatch({ type: 'drop-active', active: hovering })
      if (paths.length > 0) void acceptDrop(paths)
    })
  }, [acceptDrop])

  // Flush pending edits when the window goes away.
  useEffect(() => {
    const flush = () => {
      if (stateRef.current.editor?.dirty) void save()
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [save])

  const actions = useMemo<Actions>(
    () => ({
      refresh,
      setQuery: (query) => dispatch({ type: 'query', query }),
      setActiveTag: (tag) => dispatch({ type: 'active-tag', tag }),
      open,
      close: () => dispatch({ type: 'close' }),
      edit,
      save,
      create,
      rename,
      move,
      remove,
      togglePin,
      toggleTaskAt,
      openDaily,
      openOrCreateByTitle,
      insertAtCursor,
      resolveConflict,
      rebuildIndex,
      exportVault,
      importFolder,
      attachImage,
      setPalette: (openPalette, mode) => dispatch({ type: 'palette', open: openPalette, ...(mode ? { mode } : {}) }),
      setViewMode: (mode) => dispatch({ type: 'view-mode', mode }),
      cycleViewMode: () => dispatch({ type: 'view-mode', mode: cycleMode(stateRef.current.viewMode) }),
      createCollection,
      renameCollection,
      removeCollection,
      addPathToCollection,
      removePathFromCollection,
      openCollectionItem,
      openMenu: (request) => dispatch({ type: 'menu', menu: request }),
      closeMenu: () => dispatch({ type: 'menu', menu: null }),
      deleteFile,
      promptFor: (request) => dispatch({ type: 'prompt', prompt: request }),
      confirmFor: (request) => dispatch({ type: 'confirm', confirm: request }),
      dismissPrompt: () => dispatch({ type: 'prompt', prompt: null }),
      dismissConfirm: () => dispatch({ type: 'confirm', confirm: null }),
      createCollectionWith,
      toggleSidebar: () => dispatch({ type: 'toggle-sidebar' }),
      toggleNotesSection: () => dispatch({ type: 'toggle-notes-section' }),
      toggleFilesSection: () => dispatch({ type: 'toggle-files-section' }),
      openFileFromDisk,
      openFolderFromDisk,
      refreshTree,
      openFromTree,
      toggleTreeFolder: (path) => dispatch({ type: 'explorer-toggle-dir', path }),
      expandAllFolders,
      collapseAllFolders: () => dispatch({ type: 'explorer-set-expanded', expanded: [] }),
      setTreeFilter: (filter) => dispatch({ type: 'explorer-filter', filter }),
      closeFolder: () => dispatch({ type: 'explorer-close' }),
      checkForUpdates,
      installUpdate,
      restartForUpdate,
      dismissUpdate,
      toast,
      dismissToast: (id) => dispatch({ type: 'dismiss-toast', id }),
      reveal,
      revealPath,
      bindEditorElement: (element) => {
        editorElement.current = element
      },
    }),
    [
      attachImage,
      checkForUpdates,
      create,
      dismissUpdate,
      edit,
      installUpdate,
      restartForUpdate,
      expandAllFolders,
      exportVault,
      importFolder,
      addPathToCollection,
      createCollection,
      createCollectionWith,
      deleteFile,
      insertAtCursor,
      move,
      open,
      openCollectionItem,
      removeCollection,
      removePathFromCollection,
      renameCollection,
      openDaily,
      openFileFromDisk,
      openFolderFromDisk,
      openFromTree,
      openOrCreateByTitle,
      rebuildIndex,
      refresh,
      refreshTree,
      remove,
      rename,
      resolveConflict,
      reveal,
      revealPath,
      save,
      toast,
      toggleTaskAt,
      togglePin,
    ],
  )

  const value = useMemo<StoreValue>(
    () => ({ state, actions, vault: vaultRef.current, updater: updaterRef.current }),
    [state, actions],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext)
  if (!value) throw new Error('useStore must be used inside <StoreProvider>')
  return value
}

export function useAppState(): AppState {
  return useStore().state
}

export function useActions(): Actions {
  return useStore().actions
}
