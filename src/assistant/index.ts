/**
 * Výběr implementace asistenta.
 *
 * Desktop dostane `TauriAssistant`, prohlížeč `MemoryAssistant` označený jako
 * nedostupný -- ten pak jen řekne, že rozhovor jde vést v desktopové aplikaci,
 * místo aby to zkusil a spadl na chybějícím Tauri.
 */

import { MemoryAssistant } from './memory-assistant'
import { isAssistantAvailable, TauriAssistant } from './tauri-assistant'
import type { AssistantApi } from './api'

export * from './api'
export { MemoryAssistant, type MemoryAssistantOptions } from './memory-assistant'
export { TauriAssistant, isAssistantAvailable } from './tauri-assistant'

export function createAssistant(): AssistantApi {
  if (isAssistantAvailable()) return new TauriAssistant()
  return new MemoryAssistant({ available: false })
}
