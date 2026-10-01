/**
 * Výběr implementace feedbacku. Desktop posílá přes Rust; prohlížeč nemá
 * kudy, tak dostane paměťovou implementaci označenou jako nedostupnou.
 */

import { MemoryFeedback } from './memory-feedback'
import { isFeedbackAvailable, TauriFeedback } from './tauri-feedback'
import type { FeedbackApi } from './api'

export * from './api'
export { MemoryFeedback, type MemoryFeedbackOptions } from './memory-feedback'
export { TauriFeedback, isFeedbackAvailable } from './tauri-feedback'

export function createFeedback(): FeedbackApi {
  if (isFeedbackAvailable()) return new TauriFeedback()
  return new MemoryFeedback({ available: false })
}
