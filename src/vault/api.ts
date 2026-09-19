/**
 * The vault boundary.
 *
 * Everything the UI needs from the outside world goes through `VaultApi`.
 * There are two implementations:
 *
 *   - `TauriVault`  - the real one: files on disk, SQLite index, file watcher.
 *   - `MemoryVault` - the same semantics backed by a Map, used by `npm run
 *     dev:web`, by the end-to-end test, and as the fallback when the Tauri
 *     runtime is not reachable.
 *
 * Keeping the two honest about the same interface is why the app degrades
 * gracefully instead of throwing a wall of `window.__TAURI__ is undefined`.
 */

import type {
  Collection,
  FolderTree,
  NoteSummary,
  ThemeSetting,
  VaultError,
  ViewMode,
} from '@/core'

export interface VaultStatus {
  /** False when running in a plain browser with no Tauri runtime. */
  available: boolean
  backend: 'tauri' | 'memory'
  /** Absolute path of the vault, or a friendly label for the memory backend. */
  vaultPath: string
  noteCount: number
  /** False when SQLite was built without FTS5 and we fell back to LIKE search. */
  fullTextSearch: boolean
  /** ISO timestamp of the last full index rebuild, if known. */
  indexedAt: string | null
  /** Set when the backend is degraded but usable; shown as a banner. */
  warning?: string
}

/** A note file exactly as it exists on disk. */
export interface NoteFile {
  path: string
  content: string
  hash: string
  mtime: number
  size: number
}

/** What the index needs to know about a note. Derived in TypeScript. */
export interface IndexRecord {
  path: string
  id: string
  title: string
  body: string
  excerpt: string
  tags: string[]
  links: string[]
  pinned: boolean
  created: string
  updated: string
  hasTasks: boolean
  hash: string
  mtime: number
  size: number
}

export interface WriteResult {
  path: string
  hash: string
  mtime: number
  size: number
}

export interface BacklinkRow {
  path: string
  title: string
  context: string
}

export interface ExternalChange {
  kind: 'created' | 'modified' | 'removed'
  path: string
  hash: string | null
  mtime: number
}

/** What a drag-and-drop from the OS resolved to. */
export interface DroppedPaths {
  folder: string | null
  file: string | null
  /** How many dropped items were neither a folder nor Markdown. */
  ignored: number
}

export interface ExportResult {
  destination: string
  files: number
  bytes: number
}

export interface ImportResult {
  imported: number
  skipped: number
  /** Paths that were renamed to avoid collisions. */
  renamed: Array<{ from: string; to: string }>
}

export interface RebuildResult {
  notes: number
  durationMs: number
  fullTextSearch: boolean
}

export interface VaultSettings {
  vaultPath: string
  dailyFolder: string
  theme: ThemeSetting| 'light' | 'dark'
  editorFontSize: number
  /** Co se ukáže po otevření poznámky. */
  defaultViewMode: ViewMode
  showSidebar: boolean
  showToolbar: boolean
  /**
   * Kontrolovat po startu novou verzi.
   *
   * `PILCROW_AUTO_UPDATE=0` v `.env` to přebije i tehdy, když je tu `true`.
   */
  checkUpdates: boolean
  /**
   * Naposledy otevřená složka v průzkumníku, aby po startu byla znovu.
   *
   * Absolutní cesta. Když na tomhle počítači neexistuje, nic se neotevře
   * a nic se nehlásí -- trezor se dá přenést jinam, cesta ne.
   */
  lastFolder: string
  /** Naposledy otevřený samostatný soubor, když nebyla otevřená složka. */
  lastFile: string
  /** Šířka levého sloupce v bodech. Uživatel si ji roztahuje myší. */
  workspaceWidth: number
  /**
   * Výšky jednotlivých bloků v levém sloupci, klíč -> body.
   *
   * Chybějící klíč znamená „podle obsahu“, což je výchozí chování.
   */
  sectionHeights: Record<string, number>
  /**
   * Kam se stahují repozitáře vybrané v „Otevřít repozitář“.
   *
   * Prázdné, dokud si uživatel složku nevybere v dialogu -- tam se zároveň
   * udělí přístup. Je to jediné místo, kam aplikace zapisuje mimo trezor.
   */
  reposFolder: string
  /**
   * Smí panel asistenta posílat text poznámky ven?
   *
   * Výchozí `false` je záměr, ne opatrnost: bez tohohle přepínače z počítače
   * neodchází nic než dotaz na novou verzi, a to má zůstat pravda, dokud
   * někdo výslovně neřekne jinak.
   */
  assistantEnabled: boolean
  /** `opus`, `sonnet`, nebo prázdné = nech rozhodnout Claude Code. */
  assistantModel: string
}

export interface VaultApi {
  status(): Promise<VaultStatus>

  /** Every note in the index, newest first. Used for the note list. */
  listNotes(): Promise<NoteSummary[]>

  /** Raw file contents plus the hash the editor must send back on save. */
  readNote(path: string): Promise<NoteFile>

  /** Every note's raw text; used to rebuild the index and compute backlinks. */
  readAllNotes(): Promise<NoteFile[]>

  /**
   * Write a note. `expectedHash` is the hash the editor loaded from; when the
   * file on disk no longer matches, this rejects with a `conflict` VaultError
   * carrying both versions instead of overwriting.
   */
  writeNote(input: {
    path: string
    content: string
    expectedHash: string | null
    record: IndexRecord
  }): Promise<WriteResult>

  /** Create a new file. Rejects with `duplicate` when the path is taken. */
  createNote(input: { path: string; content: string; record: IndexRecord }): Promise<WriteResult>

  /** Move or rename. The caller is responsible for rewriting inbound links. */
  renameNote(from: string, to: string): Promise<WriteResult>

  deleteNote(path: string): Promise<void>

  /** Full-text search. An empty query returns the full list. */
  search(query: string, limit?: number): Promise<NoteSummary[]>

  backlinks(path: string): Promise<BacklinkRow[]>

  /** Drop and rebuild the SQLite index from the Markdown files. */
  rebuildIndex(records: IndexRecord[]): Promise<RebuildResult>

  /** Copy the whole vault (notes + attachments) to a folder the user picks. */
  exportVault(destination?: string): Promise<ExportResult>

  /** Copy `.md` files from a folder into the vault. */
  importFolder(source?: string): Promise<ImportResult>

  /** Copy an image into `attachments/` and return its vault-relative path. */
  importAttachment(input: { name: string; bytes: Uint8Array }): Promise<{ path: string }>

  /** Turn a vault-relative attachment path into something `<img src>` accepts. */
  attachmentUrl(path: string): string

  /** Subscribe to file-watcher events. Returns an unsubscribe function. */
  onExternalChange(handler: (change: ExternalChange) => void): () => void

  loadSettings(): Promise<VaultSettings>
  saveSettings(settings: VaultSettings): Promise<VaultSettings>

  /** Ask the OS to reveal a path. No-op when unsupported. */
  reveal(path: string): Promise<void>

  /** Prompt for a folder to export into or import from. Null when cancelled. */
  pickFolder(title: string): Promise<string | null>

  // --- the file explorer ---------------------------------------------------
  //
  // These read files outside the vault. Picking and granting access happen in
  // the same backend call, so the app can only ever read what the user chose
  // in a native dialog.

  /** Native file picker. Returns the chosen path, or null when cancelled. */
  openFileDialog(): Promise<string | null>

  /** Native folder picker. Returns the chosen path, or null when cancelled. */
  openFolderDialog(): Promise<string | null>

  /** Scan an opened folder into a tree of folders and Markdown files. */
  readFolderTree(path: string): Promise<FolderTree>

  /**
   * Re-open the folder remembered from the last run.
   *
   * Access to files outside the vault is granted per run, so a remembered path
   * has to be granted again before it can be read -- the same thing loading a
   * collection does. Returns null when the path is gone, which is not an error
   * worth a message: settings travel with the vault, machines do not.
   */
  reopenFolder(path: string): Promise<FolderTree | null>

  /** Re-open the single remembered file. Null when it is no longer there. */
  reopenFile(path: string): Promise<string | null>

  /** Read a file opened through the explorer, by absolute path. */
  readExternalFile(path: string): Promise<NoteFile>

  /**
   * Save a file opened through the explorer. Guarded by the same hash check as
   * the vault, so an external edit produces a conflict rather than a silent
   * overwrite. Unlike a vault note, the text is written exactly as given --
   * no frontmatter is added to a file Pilcrow did not create.
   */
  writeExternalFile(input: {
    path: string
    content: string
    expectedHash: string | null
  }): Promise<WriteResult>

  /**
   * Subscribe to files dragged from the OS onto the window.
   * `hovering` drives the drop affordance; `paths` is non-empty on drop.
   */
  onFileDrop(handler: (event: { hovering: boolean; paths: string[] }) => void): () => void

  /** Grant access to dropped paths and classify them. */
  acceptDroppedPaths(paths: string[]): Promise<DroppedPaths>

  /** Delete a file the explorer is showing. */
  deleteExternalFile(path: string): Promise<void>

  /**
   * Move a file the explorer is showing into the vault, so it becomes a note.
   *
   * A move: the original is gone afterwards. Returns the vault-relative path
   * it landed on, which may differ from its old name -- the vault never
   * overwrites an existing note.
   */
  moveIntoVault(path: string): Promise<string>

  // --- collections ---------------------------------------------------------

  /**
   * Your groups of files. Loading also re-grants access to every linked file,
   * so a collection still opens after a restart, and prunes entries whose file
   * has since been deleted.
   */
  loadCollections(): Promise<Collection[]>

  /** Replace the stored collections. */
  saveCollections(collections: Collection[]): Promise<Collection[]>
}

export function vaultError(kind: VaultError['kind'], message: string, extra?: Partial<VaultError>): VaultError {
  return { kind, message, ...extra }
}

export const DEFAULT_SETTINGS: VaultSettings = {
  vaultPath: '',
  dailyFolder: 'daily',
  theme: 'system',
  editorFontSize: 15,
  defaultViewMode: 'split',
  showSidebar: true,
  showToolbar: true,
  checkUpdates: true,
  lastFolder: '',
  lastFile: '',
  workspaceWidth: 300,
  sectionHeights: {},
  reposFolder: '',
  assistantEnabled: false,
  assistantModel: '',
}
