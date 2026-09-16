/**
 * The real vault: Tauri commands backed by files on disk and a SQLite index.
 *
 * This file is deliberately thin. All it does is marshal arguments, normalise
 * the error shape, and turn watcher events into callbacks -- every decision
 * about *what* to write lives in `src/core` or in Rust.
 */

import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

import {
  isVaultError,
  parseSearchQuery,
  type Collection,
  t,
  type FolderTree,
  type NoteSummary,
  type VaultError,
} from '@/core'
import {
  DEFAULT_SETTINGS,
  vaultError,
  type BacklinkRow,
  type DroppedPaths,
  type ExportResult,
  type ExternalChange,
  type ImportResult,
  type IndexRecord,
  type NoteFile,
  type RebuildResult,
  type VaultApi,
  type VaultSettings,
  type VaultStatus,
  type WriteResult,
} from './api'

const EXTERNAL_CHANGE_EVENT = 'reader-mj://external-change'

/** True when a Tauri runtime is present in this window. */
export function isTauriAvailable(): boolean {
  if (typeof window === 'undefined') return false
  const candidate = window as unknown as Record<string, unknown>
  return '__TAURI_INTERNALS__' in candidate || '__TAURI__' in candidate
}

/** Normalise anything thrown by `invoke` into a `VaultError`. */
function normalizeError(error: unknown): VaultError {
  if (isVaultError(error)) return error
  if (typeof error === 'string') {
    return vaultError('io', error)
  }
  if (error instanceof Error) return vaultError('io', error.message)
  return vaultError('io', t.errors.generic)
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args)
  } catch (error) {
    throw normalizeError(error)
  }
}

export class TauriVault implements VaultApi {
  private vaultPath = ''
  private unlisten: Promise<UnlistenFn> | null = null
  private listeners = new Set<(change: ExternalChange) => void>()

  async status(): Promise<VaultStatus> {
    const status = await call<VaultStatus>('vault_status')
    this.vaultPath = status.vaultPath
    return { ...status, available: true, backend: 'tauri' }
  }

  listNotes(): Promise<NoteSummary[]> {
    return call<NoteSummary[]>('list_notes')
  }

  readNote(path: string): Promise<NoteFile> {
    return call<NoteFile>('read_note', { path })
  }

  readAllNotes(): Promise<NoteFile[]> {
    return call<NoteFile[]>('read_all_notes')
  }

  writeNote(input: {
    path: string
    content: string
    expectedHash: string | null
    record: IndexRecord
  }): Promise<WriteResult> {
    return call<WriteResult>('write_note', {
      path: input.path,
      content: input.content,
      expectedHash: input.expectedHash,
      record: input.record,
    })
  }

  createNote(input: { path: string; content: string; record: IndexRecord }): Promise<WriteResult> {
    return call<WriteResult>('create_note', {
      path: input.path,
      content: input.content,
      record: input.record,
    })
  }

  renameNote(from: string, to: string): Promise<WriteResult> {
    return call<WriteResult>('rename_note', { from, to })
  }

  deleteNote(path: string): Promise<void> {
    return call<void>('delete_note', { path })
  }

  /**
   * Search. The query string is parsed here -- in tested TypeScript -- and the
   * structured result is handed to SQLite, so the desktop app and the
   * in-memory adapter agree on what `tag:` and `is:pinned` mean.
   */
  search(query: string, limit = 200): Promise<NoteSummary[]> {
    return call<NoteSummary[]>('search_notes', { query: parseSearchQuery(query), limit })
  }

  backlinks(path: string): Promise<BacklinkRow[]> {
    return call<BacklinkRow[]>('backlinks', { path })
  }

  rebuildIndex(records: IndexRecord[]): Promise<RebuildResult> {
    return call<RebuildResult>('rebuild_index', { records })
  }

  exportVault(destination?: string): Promise<ExportResult> {
    return call<ExportResult>('export_vault', { destination: destination ?? null })
  }

  importFolder(source?: string): Promise<ImportResult> {
    return call<ImportResult>('import_folder', { source: source ?? null })
  }

  importAttachment(input: { name: string; bytes: Uint8Array }): Promise<{ path: string }> {
    return call<{ path: string }>('import_attachment', {
      name: input.name,
      bytes: Array.from(input.bytes),
    })
  }

  attachmentUrl(path: string): string {
    if (!this.vaultPath) return ''
    const separator = this.vaultPath.includes('\\') ? '\\' : '/'
    const native = path.split('/').join(separator)
    try {
      return convertFileSrc(`${this.vaultPath}${separator}${native}`)
    } catch {
      return ''
    }
  }

  onExternalChange(handler: (change: ExternalChange) => void): () => void {
    this.listeners.add(handler)
    if (!this.unlisten) {
      this.unlisten = listen<ExternalChange>(EXTERNAL_CHANGE_EVENT, (event) => {
        for (const listener of this.listeners) listener(event.payload)
      })
    }
    return () => {
      this.listeners.delete(handler)
    }
  }

  async loadSettings(): Promise<VaultSettings> {
    try {
      return { ...DEFAULT_SETTINGS, ...(await call<VaultSettings>('load_settings')) }
    } catch {
      // Settings are a convenience, never a blocker.
      return { ...DEFAULT_SETTINGS }
    }
  }

  saveSettings(settings: VaultSettings): Promise<VaultSettings> {
    return call<VaultSettings>('save_settings', { settings })
  }

  async reveal(path: string): Promise<void> {
    try {
      await call<void>('reveal_path', { path })
    } catch {
      // Opening a file manager is best-effort; never surface a failure here.
    }
  }

  async pickFolder(title: string): Promise<string | null> {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({ directory: true, multiple: false, title })
      return typeof selected === 'string' ? selected : null
    } catch {
      return null
    }
  }

  // --- the file explorer ---------------------------------------------------

  openFileDialog(): Promise<string | null> {
    return call<string | null>('pick_markdown_file')
  }

  openFolderDialog(): Promise<string | null> {
    return call<string | null>('pick_folder')
  }

  readFolderTree(path: string): Promise<FolderTree> {
    return call<FolderTree>('read_folder_tree', { path })
  }

  readExternalFile(path: string): Promise<NoteFile> {
    return call<NoteFile>('read_external_file', { path })
  }

  writeExternalFile(input: {
    path: string
    content: string
    expectedHash: string | null
  }): Promise<WriteResult> {
    return call<WriteResult>('write_external_file', {
      path: input.path,
      content: input.content,
      expectedHash: input.expectedHash,
    })
  }

  /**
   * Files dragged from Explorer/Finder onto the window.
   *
   * Tauri delivers these as a webview-level event rather than a DOM one, so it
   * cannot be wired up with ordinary React drag handlers.
   */
  onFileDrop(handler: (event: { hovering: boolean; paths: string[] }) => void): () => void {
    let cancelled = false
    let stop: (() => void) | undefined

    void (async () => {
      try {
        const { getCurrentWebview } = await import('@tauri-apps/api/webview')
        const unlisten = await getCurrentWebview().onDragDropEvent((event) => {
          const payload = event.payload as { type: string; paths?: string[] }
          if (payload.type === 'over' || payload.type === 'enter') {
            handler({ hovering: true, paths: [] })
          } else if (payload.type === 'drop') {
            handler({ hovering: false, paths: payload.paths ?? [] })
          } else {
            handler({ hovering: false, paths: [] })
          }
        })
        if (cancelled) unlisten()
        else stop = unlisten
      } catch {
        // Drag-and-drop is a convenience; the Open buttons always work.
      }
    })()

    return () => {
      cancelled = true
      stop?.()
    }
  }

  acceptDroppedPaths(paths: string[]): Promise<DroppedPaths> {
    return call<DroppedPaths>('accept_dropped_paths', { paths })
  }

  deleteExternalFile(path: string): Promise<void> {
    return call<void>('delete_external_file', { path })
  }

  loadCollections(): Promise<Collection[]> {
    return call<Collection[]>('load_collections')
  }

  saveCollections(collections: Collection[]): Promise<Collection[]> {
    // The Rust argument is `collections_input`; `collections` alone would
    // shadow the module name on that side.
    return call<Collection[]>('save_collections', { collectionsInput: collections })
  }
}
