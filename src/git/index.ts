/**
 * Výběr implementace gitu.
 *
 * Desktop dostane `TauriGit`, prohlížeč `MemoryGit` označený jako nedostupný
 * -- sekce se pak vůbec neukáže, protože bez procesů není co spouštět.
 */

import { MemoryGit } from './memory-git'
import { isGitAvailable, TauriGit } from './tauri-git'
import type { GitApi } from './api'

export * from './api'
export { MemoryGit, type MemoryChange, type MemoryGitOptions, type MemoryRepo } from './memory-git'
export { TauriGit, isGitAvailable } from './tauri-git'

export function createGit(): GitApi {
  if (isGitAvailable()) return new TauriGit()
  return new MemoryGit({ available: false })
}
