/**
 * Skutečný asistent: `claude` běžící na tomhle počítači.
 *
 * Soubor je schválně tenký. Předá argumenty, otevře kanál a pustí kousky
 * výstupu dál. Co ty kousky znamenají, ví `@/core/assistant`; jak je ukázat,
 * ví panel. Tady se jen mluví s Rustem.
 */

import { Channel, invoke } from '@tauri-apps/api/core'

import type { AskInput, AssistantApi, AssistantChunk, AssistantSink, ProbeResult } from './api'

/** True, když v tomhle okně běží Tauri. */
export function isAssistantAvailable(): boolean {
  if (typeof window === 'undefined') return false
  const candidate = window as unknown as Record<string, unknown>
  return '__TAURI_INTERNALS__' in candidate || '__TAURI__' in candidate
}

/**
 * Kanál, který zavolá `sink` a po skončení se sám odpojí.
 *
 * Bez toho odpojení by každý dotaz nechal za sebou obsluhu, která už nikdy
 * nic nedostane, ale drží komponentu naživu.
 */
function sinkChannel(sink: AssistantSink): Channel<AssistantChunk> {
  const channel = new Channel<AssistantChunk>()
  channel.onmessage = (chunk) => {
    sink(chunk)
  }
  return channel
}

export class TauriAssistant implements AssistantApi {
  readonly available = true

  probe(): Promise<ProbeResult> {
    return invoke<ProbeResult>('assistant_status')
  }

  installCommand(): Promise<string> {
    return invoke<string>('assistant_install_command')
  }

  install(sink: AssistantSink): Promise<void> {
    return invoke<void>('assistant_install', { channel: sinkChannel(sink) })
  }

  login(sink: AssistantSink): Promise<void> {
    return invoke<void>('assistant_login', { channel: sinkChannel(sink) })
  }

  loginCode(code: string): Promise<void> {
    return invoke<void>('assistant_login_code', { code })
  }

  loginCancel(): Promise<void> {
    return invoke<void>('assistant_login_cancel')
  }

  logout(): Promise<void> {
    return invoke<void>('assistant_logout')
  }

  ask(input: AskInput, sink: AssistantSink): Promise<void> {
    return invoke<void>('assistant_ask', {
      request: {
        prompt: input.prompt,
        system: input.system,
        sessionId: input.sessionId,
        model: input.model,
      },
      channel: sinkChannel(sink),
    })
  }

  cancel(): Promise<void> {
    return invoke<void>('assistant_cancel')
  }
}
