/**
 * Hranice feedbacku.
 *
 * Stejný vzor jako `GitApi` a `AssistantApi`: jedno rozhraní, dvě skutečné
 * implementace.
 *
 *   - `TauriFeedback`  - posílá Rust, na jednu zakompilovanou adresu.
 *   - `MemoryFeedback` - zapamatuje si, co by odešlo. Pro testy a prohlížeč.
 */

import type { FeedbackRequest } from '@/core'

export interface FeedbackStatus {
  /** Jde feedback poslat? `false` v prohlížeči a bez nastavené adresy. */
  available: boolean
  /** Kam feedback odejde -- ukazuje se v okně. */
  host: string
  version: string
  os: string
  error: string
}

export interface FeedbackApi {
  status(): Promise<FeedbackStatus>
  /** Poslat. Vrací ID, pod kterým feedback dorazil. */
  send(request: FeedbackRequest): Promise<string>
}

/** Vytáhnout z čehokoli chybovou větu, kterou jde ukázat člověku. */
export function feedbackMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) return error
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return fallback
}
