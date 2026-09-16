/**
 * Skutečná implementace aktualizací nad pluginem Tauri.
 *
 * Plugin sám stáhne `latest.json` z GitHub Releases, ověří podpis balíčku
 * veřejným klíčem z `tauri.conf.json` a spustí instalátor. Nepodepsaný nebo
 * cizím klíčem podepsaný balíček se nenainstaluje -- to je celý důvod, proč
 * se aktualizace podepisují.
 *
 * Tady navíc kontrolujeme, že nabízená verze je opravdu novější. Plugin to
 * dělá taky, ale pojistka na naší straně je levná a `isNewer` je otestovaná.
 */

import { isNewer } from '@/core'
import { updaterError, type DownloadProgress, type UpdateInfo, type UpdaterApi } from './api'

/** Co z pluginu opravdu používáme. Napsané ručně, ať se nedováží typy zbytečně. */
interface PluginUpdate {
  version: string
  currentVersion: string
  body?: string | null
  date?: string | null
  download(handler: (event: PluginDownloadEvent) => void): Promise<void>
  install(): Promise<void>
  close?: () => Promise<void>
}

type PluginDownloadEvent =
  | { event: 'Started'; data: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' }

export function isUpdaterAvailable(): boolean {
  if (typeof window === 'undefined') return false
  // Stejná detekce jako u trezoru: bez běhového prostředí Tauri není co volat.
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window
}

/** GitHub vrací síťové chyby jako text; poznáme je podle něj a řekneme to česky. */
function classify(error: unknown) {
  const text = error instanceof Error ? error.message : String(error)
  const lower = text.toLowerCase()
  if (lower.includes('signature') || lower.includes('minisign') || lower.includes('verif')) {
    return updaterError(
      'signature',
      'Podpis stažené aktualizace nesedí. Nic se nenainstalovalo. Stáhni novou verzi ručně z GitHubu.',
    )
  }
  if (
    lower.includes('network') ||
    lower.includes('dns') ||
    lower.includes('timed out') ||
    lower.includes('timeout') ||
    lower.includes('connect') ||
    lower.includes('request')
  ) {
    return updaterError('network', 'Na server s aktualizacemi se teď nedá dostat. Zkus to později.')
  }
  return updaterError('other', text || 'Aktualizaci se nepodařilo dokončit.')
}

export class TauriUpdater implements UpdaterApi {
  readonly available = isUpdaterAvailable()

  /** Výsledek posledního `check()`. Instalovat se smí jen tohle. */
  private pending: PluginUpdate | null = null

  async currentVersion(): Promise<string> {
    if (!this.available) return '0.0.0'
    const { getVersion } = await import('@tauri-apps/api/app')
    return getVersion()
  }

  async autoCheckEnabled(): Promise<boolean> {
    if (!this.available) return false
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      return await invoke<boolean>('auto_update_enabled')
    } catch {
      // Starší sestavení ten příkaz nemá. Automatická kontrola je výchozí
      // chování, takže se na to nedá odpovědět jinak než ano.
      return true
    }
  }

  /**
   * Který balíček z manifestu chceme. Rozhoduje Rust, protože jen on ví,
   * na čem doopravdy běžíme. `null` = ať si vybere plugin.
   */
  private async preferredTarget(): Promise<string | null> {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      return (await invoke<string | null>('updater_target')) ?? null
    } catch {
      return null
    }
  }

  async check(): Promise<UpdateInfo | null> {
    if (!this.available) {
      throw updaterError('unavailable', 'Aktualizace fungují jen v desktopové aplikaci.')
    }

    // Předchozí nabídku zahodit, ať se nedá nainstalovat něco zastaralého.
    await this.discard()

    let update: PluginUpdate | null
    try {
      const { check } = await import('@tauri-apps/plugin-updater')
      const target = await this.preferredTarget()
      try {
        update = (await check(target ? { target } : undefined)) as PluginUpdate | null
      } catch (error) {
        // Starší vydání nemusí mít v manifestu záznam pro vyžádaný balíček.
        // Než aby aktualizace přestaly fungovat úplně, zkusíme to ještě
        // jednou po pluginově.
        if (!target) throw error
        update = (await check()) as PluginUpdate | null
      }
    } catch (error) {
      throw classify(error)
    }

    if (!update) return null

    const current = update.currentVersion || (await this.currentVersion())
    if (!isNewer(update.version, current)) {
      // Server nabídl stejnou nebo starší verzi. Nic z toho neděláme.
      await this.discard()
      return null
    }

    this.pending = update
    return {
      version: update.version,
      currentVersion: current,
      notes: update.body ?? '',
      date: update.date ?? null,
    }
  }

  async download(onProgress?: (progress: DownloadProgress) => void): Promise<void> {
    const update = this.pending
    if (!update) {
      throw updaterError('other', 'Není co stahovat. Zkontroluj aktualizace znovu.')
    }

    let downloaded = 0
    let total: number | null = null

    try {
      await update.download((event) => {
        switch (event.event) {
          case 'Started':
            total = event.data.contentLength ?? null
            downloaded = 0
            break
          case 'Progress':
            downloaded += event.data.chunkLength
            break
          case 'Finished':
            // Když server velikost nehlásil, dopočítáme ji z toho, co přišlo.
            total = total ?? downloaded
            downloaded = total
            break
        }
        onProgress?.({ downloaded, total })
      })
    } catch (error) {
      throw classify(error)
    }
  }

  async install(): Promise<void> {
    const update = this.pending
    if (!update) {
      throw updaterError('other', 'Není co instalovat. Zkontroluj aktualizace znovu.')
    }
    try {
      await update.install()
    } catch (error) {
      throw classify(error)
    }
  }

  async relaunch(): Promise<void> {
    if (!this.available) return
    const { relaunch } = await import('@tauri-apps/plugin-process')
    await relaunch()
  }

  /** Uvolnit nabídku, na kterou už se nečeká. */
  private async discard(): Promise<void> {
    const previous = this.pending
    this.pending = null
    try {
      await previous?.close?.()
    } catch {
      /* zavření nabídky je úklid, ne něco, kvůli čemu hlásit chybu */
    }
  }
}
