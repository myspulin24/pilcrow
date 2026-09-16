/**
 * In-memory vault.
 *
 * Same contract as the real one, backed by a `Map<path, text>`. It powers:
 *   - `npm run dev:web` (UI work in a plain browser, no Rust rebuild)
 *   - the end-to-end test
 *   - the fallback when the Tauri runtime is missing, so the app renders a
 *     read/write scratch vault and an honest banner instead of a blank screen
 *
 * Because it shares `src/core` with the real adapter, behaviour it proves in a
 * test -- conflict detection, link rewriting, search ranking -- is the same
 * behaviour the desktop app has.
 */

import {
  buildTreeFromPaths,
  computeBacklinks,
  hashText,
  parseNote,
  parseSearchQuery,
  safeAttachmentName,
  searchNotes,
  t,
  titleFromPath,
  type Collection,
  type FolderTree,
  type NoteSummary,
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

interface Entry {
  content: string
  mtime: number
}

export interface MemoryVaultOptions {
  /** Notes to start with, keyed by vault-relative path. */
  seed?: Record<string, string>
  label?: string
  warning?: string
  now?: () => number
  /**
   * A simulated file system outside the vault, keyed by absolute path. Stands
   * in for what the explorer would read from disk.
   */
  externalFiles?: Record<string, string>
  /** What the folder picker returns. */
  externalRoot?: string
  /** What the file picker returns. Defaults to the first external file. */
  dialogFile?: string
}

export class MemoryVault implements VaultApi {
  private files = new Map<string, Entry>()
  private attachments = new Map<string, Uint8Array>()
  private records = new Map<string, IndexRecord>()
  private listeners = new Set<(change: ExternalChange) => void>()
  private dropListeners = new Set<(event: { hovering: boolean; paths: string[] }) => void>()
  private settings: VaultSettings = { ...DEFAULT_SETTINGS }
  private indexedAt: string | null = null
  private label: string
  private warning: string | undefined
  private now: () => number
  /** Stand-in for the world outside the vault, keyed by absolute path. */
  private externalFiles = new Map<string, string>()
  private externalRoot: string | null
  private dialogFile: string | null
  private collections: Collection[] = []

  constructor(options: MemoryVaultOptions = {}) {
    this.label = options.label ?? t.browser.memoryVault
    this.warning = options.warning
    this.now = options.now ?? (() => Date.now())
    for (const [path, content] of Object.entries(options.seed ?? {})) {
      this.files.set(path, { content, mtime: this.now() })
    }
    for (const [path, content] of Object.entries(options.externalFiles ?? {})) {
      this.externalFiles.set(path, content)
    }
    this.externalRoot = options.externalRoot ?? null
    this.dialogFile = options.dialogFile ?? [...this.externalFiles.keys()][0] ?? null
    this.settings.vaultPath = this.label
  }

  async status(): Promise<VaultStatus> {
    return {
      available: true,
      backend: 'memory',
      vaultPath: this.label,
      noteCount: this.files.size,
      fullTextSearch: true,
      indexedAt: this.indexedAt,
      ...(this.warning ? { warning: this.warning } : {}),
    }
  }

  async listNotes(): Promise<NoteSummary[]> {
    if (this.records.size === 0 && this.files.size > 0) {
      await this.rebuildIndex(this.deriveRecords())
    }
    return [...this.records.values()]
      .map(toSummary)
      .sort(byPinnedThenUpdated)
  }

  async readNote(path: string): Promise<NoteFile> {
    const entry = this.files.get(path)
    if (!entry) throw vaultError('not-found', `Poznámka ${path} neexistuje`)
    return this.toFile(path, entry)
  }

  async readAllNotes(): Promise<NoteFile[]> {
    return [...this.files.entries()].map(([path, entry]) => this.toFile(path, entry))
  }

  async writeNote(input: {
    path: string
    content: string
    expectedHash: string | null
    record: IndexRecord
  }): Promise<WriteResult> {
    const existing = this.files.get(input.path)
    if (existing && input.expectedHash !== null) {
      const diskHash = hashText(existing.content)
      if (diskHash !== input.expectedHash) {
        throw vaultError('conflict', `Soubor ${input.path} se na disku změnil od chvíle, kdy byl otevřen`, {
          conflict: {
            path: input.path,
            local: input.content,
            disk: existing.content,
            baseHash: input.expectedHash,
            diskHash,
            detectedAt: this.now(),
          },
        })
      }
    }
    return this.put(input.path, input.content, input.record)
  }

  async createNote(input: { path: string; content: string; record: IndexRecord }): Promise<WriteResult> {
    if (this.files.has(input.path)) {
      throw vaultError('duplicate', `Poznámka ${input.path} už existuje`)
    }
    return this.put(input.path, input.content, input.record)
  }

  async renameNote(from: string, to: string): Promise<WriteResult> {
    const entry = this.files.get(from)
    if (!entry) throw vaultError('not-found', `Poznámka ${from} neexistuje`)
    if (this.files.has(to)) throw vaultError('duplicate', `Poznámka ${to} už existuje`)

    this.files.delete(from)
    this.files.set(to, entry)

    const record = this.records.get(from)
    this.records.delete(from)
    if (record) this.records.set(to, { ...record, path: to })

    this.emit({ kind: 'removed', path: from, hash: null, mtime: this.now() })
    return { path: to, hash: hashText(entry.content), mtime: entry.mtime, size: entry.content.length }
  }

  async deleteNote(path: string): Promise<void> {
    if (!this.files.delete(path)) throw vaultError('not-found', `No note at ${path}`)
    this.records.delete(path)
  }

  async search(query: string, limit = 200): Promise<NoteSummary[]> {
    const parsed = parseSearchQuery(query)
    const rows = [...this.records.values()]
    if (parsed.isEmpty) return rows.map(toSummary).sort(byPinnedThenUpdated).slice(0, limit)

    return searchNotes(
      rows.map((record) => ({
        path: record.path,
        title: record.title,
        body: record.body,
        tags: record.tags,
        pinned: record.pinned,
        hasTasks: record.hasTasks,
        updated: record.updated,
        record,
      })),
      parsed,
    )
      .slice(0, limit)
      .map(({ note, snippet }) => ({ ...toSummary(note.record), snippet }))
  }

  async backlinks(path: string): Promise<BacklinkRow[]> {
    const notes = [...this.files.entries()].map(([notePath, entry]) => {
      const parsed = parseNote(entry.content, { path: notePath })
      return { path: notePath, title: parsed.frontmatter.title, body: parsed.body }
    })
    return computeBacklinks(path, notes).map((link) => ({
      path: link.from,
      title: notes.find((note) => note.path === link.from)?.title ?? titleFromPath(link.from),
      context: link.context,
    }))
  }

  async rebuildIndex(records: IndexRecord[]): Promise<RebuildResult> {
    const started = this.now()
    this.records.clear()
    for (const record of records) this.records.set(record.path, record)
    this.indexedAt = new Date(this.now()).toISOString()
    return { notes: this.records.size, durationMs: Math.max(0, this.now() - started), fullTextSearch: true }
  }

  async exportVault(destination?: string): Promise<ExportResult> {
    // Nothing to copy to; report what a real export would have written so the
    // UI can still show a truthful success state in browser mode.
    let bytes = 0
    for (const entry of this.files.values()) bytes += entry.content.length
    return {
      destination: destination ?? t.browser.exportNeedsDesktop,
      files: this.files.size + this.attachments.size,
      bytes,
    }
  }

  async importFolder(): Promise<ImportResult> {
    throw vaultError('unavailable', t.browser.importNeedsDesktop)
  }

  async importAttachment(input: { name: string; bytes: Uint8Array }): Promise<{ path: string }> {
    const path = `attachments/${safeAttachmentName(input.name, new Date(this.now()))}`
    this.attachments.set(path, input.bytes)
    return { path }
  }

  attachmentUrl(path: string): string {
    const bytes = this.attachments.get(path)
    if (!bytes) return ''
    // jsdom has no object URLs, and neither does a worker without a document.
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return ''
    // `slice()` copies into a plain ArrayBuffer, which is what Blob accepts.
    return URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer]))
  }

  onExternalChange(handler: (change: ExternalChange) => void): () => void {
    this.listeners.add(handler)
    return () => this.listeners.delete(handler)
  }

  async loadSettings(): Promise<VaultSettings> {
    return { ...this.settings }
  }

  async saveSettings(settings: VaultSettings): Promise<VaultSettings> {
    this.settings = { ...settings, vaultPath: this.label }
    return { ...this.settings }
  }

  async reveal(): Promise<void> {
    /* no file manager in memory mode */
  }

  async pickFolder(): Promise<string | null> {
    return null
  }

  // -- the file explorer ----------------------------------------------------

  async openFileDialog(): Promise<string | null> {
    return this.dialogFile
  }

  async openFolderDialog(): Promise<string | null> {
    return this.externalRoot
  }

  async readFolderTree(path: string): Promise<FolderTree> {
    const prefix = path.replace(/[\\/]+$/, '')
    const inside = [...this.externalFiles.keys()].filter(
      (candidate) => candidate.startsWith(`${prefix}/`) || candidate.startsWith(`${prefix}\\`),
    )
    if (inside.length === 0 && prefix !== this.externalRoot?.replace(/[\\/]+$/, '')) {
      throw vaultError('not-found', `${path} není složka.`)
    }
    return buildTreeFromPaths(path, inside)
  }

  async readExternalFile(path: string): Promise<NoteFile> {
    const content = this.externalFiles.get(path)
    if (content === undefined) throw vaultError('not-found', `${path} už neexistuje.`)
    return {
      path,
      content,
      hash: hashText(content),
      mtime: this.now(),
      size: content.length,
    }
  }

  async writeExternalFile(input: {
    path: string
    content: string
    expectedHash: string | null
  }): Promise<WriteResult> {
    const existing = this.externalFiles.get(input.path)
    if (existing !== undefined && input.expectedHash !== null) {
      const diskHash = hashText(existing)
      if (diskHash !== input.expectedHash) {
        throw vaultError('conflict', `Soubor ${input.path} se na disku změnil od chvíle, kdy byl otevřen`, {
          conflict: {
            path: input.path,
            local: input.content,
            disk: existing,
            baseHash: input.expectedHash,
            diskHash,
            detectedAt: this.now(),
          },
        })
      }
    }
    // Written verbatim: an external file never gains frontmatter it did not have.
    this.externalFiles.set(input.path, input.content)
    return {
      path: input.path,
      hash: hashText(input.content),
      mtime: this.now(),
      size: input.content.length,
    }
  }

  onFileDrop(handler: (event: { hovering: boolean; paths: string[] }) => void): () => void {
    this.dropListeners.add(handler)
    return () => this.dropListeners.delete(handler)
  }

  async acceptDroppedPaths(paths: string[]): Promise<DroppedPaths> {
    let folder: string | null = null
    let file: string | null = null
    let ignored = 0

    for (const path of paths) {
      const isFolder = [...this.externalFiles.keys()].some(
        (candidate) => candidate.startsWith(`${path}/`) || candidate.startsWith(`${path}\\`),
      )
      if (isFolder) folder ??= path
      else if (this.externalFiles.has(path)) file ??= path
      else ignored += 1
    }
    return { folder, file, ignored }
  }

  async deleteExternalFile(path: string): Promise<void> {
    if (!this.externalFiles.delete(path)) {
      throw vaultError('not-found', `${path} už neexistuje.`)
    }
  }

  async loadCollections(): Promise<Collection[]> {
    // Mirror the real backend: entries whose file is gone are pruned.
    this.collections = this.collections.map((collection) => ({
      ...collection,
      items: collection.items.filter(
        (item) => !item.external || this.externalFiles.has(item.path),
      ),
    }))
    return structuredClone(this.collections)
  }

  async saveCollections(collections: Collection[]): Promise<Collection[]> {
    this.collections = structuredClone(collections)
    return structuredClone(this.collections)
  }

  // -- test / dev helpers ---------------------------------------------------

  /** Simulate another program editing a file, exactly as the watcher would. */
  simulateExternalEdit(path: string, content: string): void {
    const mtime = this.now() + 1
    this.files.set(path, { content, mtime })
    this.emit({ kind: 'modified', path, hash: hashText(content), mtime })
  }

  /** Raw contents, for assertions. */
  peek(path: string): string | undefined {
    return this.files.get(path)?.content
  }

  /** Raw contents of a simulated external file, for assertions. */
  peekExternal(path: string): string | undefined {
    return this.externalFiles.get(path)
  }

  /** Simulate dragging files from the OS onto the window. */
  simulateDrop(paths: string[]): void {
    for (const listener of this.dropListeners) listener({ hovering: false, paths })
  }

  /** Simulate another program editing a file outside the vault. */
  simulateExternalFileEdit(path: string, content: string): void {
    this.externalFiles.set(path, content)
  }

  paths(): string[] {
    return [...this.files.keys()]
  }

  private deriveRecords(): IndexRecord[] {
    const records: IndexRecord[] = []
    for (const [path, entry] of this.files) {
      const parsed = parseNote(entry.content, { path })
      records.push({
        path,
        id: parsed.frontmatter.id,
        title: parsed.frontmatter.title || titleFromPath(path),
        body: parsed.body,
        excerpt: parsed.excerpt,
        tags: parsed.tags,
        links: parsed.links.map((link) => link.target.toLowerCase()),
        pinned: parsed.frontmatter.pinned,
        created: parsed.frontmatter.created,
        updated: parsed.frontmatter.updated,
        hasTasks: parsed.tasks.total > 0,
        hash: hashText(entry.content),
        mtime: entry.mtime,
        size: entry.content.length,
      })
    }
    return records
  }

  private put(path: string, content: string, record: IndexRecord): WriteResult {
    const mtime = this.now()
    this.files.set(path, { content, mtime })
    const hash = hashText(content)
    this.records.set(path, { ...record, path, hash, mtime, size: content.length })
    return { path, hash, mtime, size: content.length }
  }

  private toFile(path: string, entry: Entry): NoteFile {
    return {
      path,
      content: entry.content,
      hash: hashText(entry.content),
      mtime: entry.mtime,
      size: entry.content.length,
    }
  }

  private emit(change: ExternalChange): void {
    for (const listener of this.listeners) listener(change)
  }
}

function toSummary(record: IndexRecord): NoteSummary {
  return {
    id: record.id,
    path: record.path,
    title: record.title,
    excerpt: record.excerpt,
    tags: record.tags,
    pinned: record.pinned,
    created: record.created,
    updated: record.updated,
  }
}

function byPinnedThenUpdated(a: NoteSummary, b: NoteSummary): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  return b.updated.localeCompare(a.updated)
}
