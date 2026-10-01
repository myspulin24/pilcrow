/**
 * Skutečný feedback: posílá Rust. Soubor je schválně tenký -- adresu ani
 * hlavičky webview neurčuje, předá jen obsah.
 */

import { invoke } from '@tauri-apps/api/core'

import type { FeedbackRequest } from '@/core'
import type { FeedbackApi, FeedbackStatus } from './api'

export function isFeedbackAvailable(): boolean {
  if (typeof window === 'undefined') return false
  const candidate = window as unknown as Record<string, unknown>
  return '__TAURI_INTERNALS__' in candidate || '__TAURI__' in candidate
}

export class TauriFeedback implements FeedbackApi {
  status(): Promise<FeedbackStatus> {
    return invoke<FeedbackStatus>('feedback_status')
  }

  async send(request: FeedbackRequest): Promise<string> {
    const receipt = await invoke<{ id: string }>('feedback_send', { request })
    return receipt.id
  }
}
