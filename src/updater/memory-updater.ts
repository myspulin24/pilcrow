/**
 * Aktualizace bez sítě.
 *
 * Používá se v prohlížeči (`npm run dev:web`) a v testech. Není to atrapa --
 * vynucuje stejná pravidla jako ta skutečná:
 *
 *   - nabídne jen verzi, která je opravdu novější;
 *   - instalovat jde jen to, co prošlo `check()`;
 *   - stahování hlásí postup po kouscích, takže se dá otestovat ukazatel.
 */

import { isNewer } from '@/core'
import { updaterError, type DownloadProgress, type UpdateInfo, type UpdaterApi } from './api'

export interface MemoryUpdaterOptions {
  /** Verze, která „běží“. */
  currentVersion?: string
  /** Co má server nabídnout. `null` = nic nového. */
  latest?: { version: string; notes?: string; date?: string | null } | null
  /** Velikost balíčku v bajtech, rozdělená na `chunks` kroků. */
  size?: number
  chunks?: number
  /** Nastav, ať `check()` selže -- pro test chybového stavu. */
  failCheck?: string
  /** Nastav, ať stahování selže. */
  failDownload?: string
  /** `false` znamená, že se v tomhle prostředí aktualizovat nedá. */
  available?: boolean
  /** `false` vypne kontrolu po startu, stejně jako `READER_MJ_AUTO_UPDATE=0`. */
  autoCheck?: boolean
}

export class MemoryUpdater implements UpdaterApi {
  readonly available: boolean

  private version: string
  private latest: MemoryUpdaterOptions['latest']
  private size: number
  private chunks: number
  private failCheckWith?: string
  private failDownloadWith?: string
  private autoCheck: boolean

  private pending: UpdateInfo | null = null
  /** Verze, která už je stažená. Instalovat jde jen ta. */
  private downloadedVersion: string | null = null

  /** Kolikrát se instalovalo a jestli padl restart -- na to se testy ptají. */
  installs = 0
  relaunched = false

  constructor(options: MemoryUpdaterOptions = {}) {
    this.available = options.available ?? true
    this.version = options.currentVersion ?? '0.1.0'
    this.latest = options.latest ?? null
    this.size = options.size ?? 4 * 1024 * 1024
    this.chunks = Math.max(1, options.chunks ?? 4)
    this.failCheckWith = options.failCheck
    this.failDownloadWith = options.failDownload
    this.autoCheck = options.autoCheck ?? true
  }

  /** Vydat novou verzi za běhu, ať se dá test posunout dál. */
  publish(version: string, notes = ''): void {
    this.latest = { version, notes }
  }

  async currentVersion(): Promise<string> {
    return this.version
  }

  async autoCheckEnabled(): Promise<boolean> {
    return this.autoCheck
  }

  async check(): Promise<UpdateInfo | null> {
    if (!this.available) {
      throw updaterError('unavailable', 'Aktualizace fungují jen v desktopové aplikaci.')
    }
    if (this.failCheckWith) {
      throw updaterError('network', this.failCheckWith)
    }

    this.pending = null
    if (!this.latest || !isNewer(this.latest.version, this.version)) return null

    this.pending = {
      version: this.latest.version,
      currentVersion: this.version,
      notes: this.latest.notes ?? '',
      date: this.latest.date ?? null,
    }
    return this.pending
  }

  async download(onProgress?: (progress: DownloadProgress) => void): Promise<void> {
    if (!this.pending) {
      throw updaterError('other', 'Není co stahovat. Zkontroluj aktualizace znovu.')
    }
    if (this.failDownloadWith) {
      throw updaterError('network', this.failDownloadWith)
    }

    const step = Math.ceil(this.size / this.chunks)
    let downloaded = 0
    onProgress?.({ downloaded: 0, total: this.size })
    for (let i = 0; i < this.chunks; i++) {
      downloaded = Math.min(this.size, downloaded + step)
      onProgress?.({ downloaded, total: this.size })
      // Pauza o délce nula: postup dorazí na několik tiků, ne najednou.
      await Promise.resolve()
    }
    this.downloadedVersion = this.pending.version
  }

  async install(): Promise<void> {
    const update = this.pending
    if (!update || this.downloadedVersion !== update.version) {
      // Stejné pravidlo jako u té skutečné: instaluje se jen stažené.
      throw updaterError('other', 'Aktualizace není stažená.')
    }
    this.installs += 1
    // Po instalaci už běží nová verze; další kontrola nesmí nabídnout totéž.
    this.version = update.version
    this.pending = null
    this.downloadedVersion = null
  }

  async relaunch(): Promise<void> {
    this.relaunched = true
  }
}
