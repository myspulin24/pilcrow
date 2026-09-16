/**
 * Výběr implementace aktualizací.
 *
 * Desktop dostane `TauriUpdater`, prohlížeč `MemoryUpdater` označený jako
 * nedostupný -- ten pak jen řekne, že aktualizovat jde v desktopové aplikaci,
 * místo aby to zkusil a spadl.
 */

import { MemoryUpdater } from './memory-updater'
import { isUpdaterAvailable, TauriUpdater } from './tauri-updater'
import type { UpdaterApi } from './api'

export * from './api'
export { MemoryUpdater, type MemoryUpdaterOptions } from './memory-updater'
export { TauriUpdater, isUpdaterAvailable } from './tauri-updater'

export function createUpdater(): UpdaterApi {
  if (isUpdaterAvailable()) return new TauriUpdater()
  return new MemoryUpdater({ available: false })
}
