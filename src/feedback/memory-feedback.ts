/**
 * Feedback bez sítě: zapamatuje si, co by odešlo.
 *
 * Pro testy a pro `npm run dev:web`. V prohlížeči je označený jako
 * nedostupný, takže okno poctivě řekne, že posílat jde jen z aplikace.
 */

import type { FeedbackRequest } from '@/core'
import type { FeedbackApi, FeedbackStatus } from './api'

export interface MemoryFeedbackOptions {
  available?: boolean
  /** Nechat odeslání selhat s touhle zprávou. */
  fail?: string
  /**
   * Zadržet odeslání, dokud test nezavolá `finish`. Bez toho by se stav
   * „odesílám“ nedal zachytit.
   */
  hold?: boolean
}

export class MemoryFeedback implements FeedbackApi {
  /** Co odešlo, v pořadí. K ověření v testech. */
  readonly sent: FeedbackRequest[] = []
  /** Dokončit zadržené odeslání. */
  finish: (() => void) | null = null
  fail: string

  private readonly options: MemoryFeedbackOptions

  constructor(options: MemoryFeedbackOptions = {}) {
    this.options = options
    this.fail = options.fail ?? ''
  }

  async status(): Promise<FeedbackStatus> {
    const available = this.options.available ?? true
    return {
      available,
      host: available ? 'feedback.example' : '',
      version: '0.0.0-test',
      os: 'test (x86_64)',
      error: available ? '' : 'Feedback jde poslat jen z desktopové aplikace.',
    }
  }

  async send(request: FeedbackRequest): Promise<string> {
    if (this.options.hold) {
      await new Promise<void>((resolve) => {
        this.finish = () => {
          this.finish = null
          resolve()
        }
      })
    }
    if (this.fail) throw new Error(this.fail)
    this.sent.push(request)
    return `test${String(this.sent.length).padStart(4, '0')}`
  }
}
