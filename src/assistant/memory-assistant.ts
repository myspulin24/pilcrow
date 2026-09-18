/**
 * Asistent bez procesu.
 *
 * Používá se ve třech situacích: v prohlížeči (`npm run dev:web`), v testech
 * a všude, kde `claude` není. Není to atrapa -- drží stejná pravidla jako ta
 * pravá implementace:
 *
 *   - dokud není nainstalováno, nejde se přihlásit;
 *   - dokud není přihlášeno, nejde se ptát;
 *   - přihlášení čeká na kód z prohlížeče;
 *   - odpověď chodí po kouscích ve stejném formátu, jaký vypisuje CLI.
 *
 * Díky tomu se celá příprava i rozhovor dají projít v testu, aniž by se
 * cokoli spustilo nebo odeslalo.
 */

import type { AskInput, AssistantApi, AssistantSink, ProbeResult } from './api'

export interface MemoryAssistantOptions {
  /** `false` v prohlížeči: UI pak řekne, že tohle jde jen v aplikaci. */
  available?: boolean
  installed?: boolean
  loggedIn?: boolean
  email?: string
  plan?: string
  /** Co odpoví na otázku. Výchozí je krátká věta. */
  reply?: string | ((input: AskInput) => string)
  /** Kód, který přihlášení uzná. */
  code?: string
  /** Nechat instalaci selhat, ať jde otestovat i ta cesta. */
  failInstall?: string
  /** Nechat dotaz selhat. */
  failAsk?: string
}

const LOGIN_URL = 'https://claude.com/cai/oauth/authorize?code=true&client_id=pilcrow-demo'

/** Rozsekat odpověď na kousky, aby se v panelu objevovala postupně. */
function pieces(text: string): string[] {
  return text.match(/\s*\S+/g) ?? [text]
}

export class MemoryAssistant implements AssistantApi {
  readonly available: boolean

  private installed: boolean
  private loggedIn: boolean
  private readonly options: MemoryAssistantOptions
  private loginSink: AssistantSink | null = null
  private cancelled = false

  constructor(options: MemoryAssistantOptions = {}) {
    this.options = options
    this.available = options.available ?? true
    this.installed = options.installed ?? true
    this.loggedIn = options.loggedIn ?? true
  }

  async probe(): Promise<ProbeResult> {
    if (!this.installed) {
      return { installed: false, version: '', path: '', auth: '', error: '' }
    }
    return {
      installed: true,
      version: '2.1.0 (Pilcrow, paměťová implementace)',
      path: 'claude',
      auth: JSON.stringify({
        loggedIn: this.loggedIn,
        authMethod: this.loggedIn ? 'claude.ai' : '',
        email: this.loggedIn ? (this.options.email ?? 'ty@příklad.cz') : '',
        subscriptionType: this.loggedIn ? (this.options.plan ?? 'max') : '',
        orgName: '',
      }),
      error: '',
    }
  }

  async installCommand(): Promise<string> {
    return 'irm https://claude.ai/install.ps1 | iex'
  }

  async install(sink: AssistantSink): Promise<void> {
    sink({ kind: 'out', text: 'Stahuji Claude Code…\n' })
    if (this.options.failInstall) {
      sink({ kind: 'failed', message: this.options.failInstall })
      return
    }
    this.installed = true
    sink({ kind: 'out', text: 'Hotovo.\n' })
    sink({ kind: 'finished' })
  }

  async login(sink: AssistantSink): Promise<void> {
    if (!this.installed) {
      sink({ kind: 'failed', message: 'Claude Code není nainstalovaný.' })
      return
    }
    this.loginSink = sink
    sink({ kind: 'out', text: 'Otevírám prohlížeč…\n' })
    sink({ kind: 'out', text: `Pokud se prohlížeč neotevřel, jdi na: ${LOGIN_URL}\n` })
    sink({ kind: 'out', text: 'Paste code here if prompted > ' })
  }

  async loginCode(code: string): Promise<void> {
    const sink = this.loginSink
    if (!sink) throw new Error('Přihlašování už neběží. Spusť ho znovu.')

    if (code.trim() !== (this.options.code ?? 'ok')) {
      this.loginSink = null
      sink({ kind: 'failed', message: 'Kód nesedí. Zkus to znovu.' })
      return
    }
    this.loggedIn = true
    this.loginSink = null
    sink({ kind: 'out', text: '\nPřihlášeno.\n' })
    sink({ kind: 'finished' })
  }

  async loginCancel(): Promise<void> {
    this.loginSink = null
  }

  async logout(): Promise<void> {
    this.loggedIn = false
  }

  async ask(input: AskInput, sink: AssistantSink): Promise<void> {
    if (!this.installed || !this.loggedIn) {
      sink({ kind: 'failed', message: 'Claude není připravený.' })
      return
    }
    if (this.options.failAsk) {
      sink({ kind: 'failed', message: this.options.failAsk })
      return
    }

    this.cancelled = false
    const reply =
      typeof this.options.reply === 'function'
        ? this.options.reply(input)
        : (this.options.reply ?? 'Rozumím. V poznámce o tom nic není.')

    // Stejné řádky, jaké posílá `claude --output-format stream-json`. Kdyby se
    // tady zjednodušily, testy by míjely přesně to místo, kde se chybuje.
    for (const piece of pieces(reply)) {
      if (this.cancelled) return
      sink({
        kind: 'out',
        text: `${JSON.stringify({
          type: 'stream_event',
          event: { type: 'content_block_delta', delta: { type: 'text_delta', text: piece } },
        })}\n`,
      })
    }
    if (this.cancelled) return

    sink({
      kind: 'out',
      text: `${JSON.stringify({
        type: 'result',
        is_error: false,
        result: reply,
        session_id: input.sessionId ?? 'sezeni-1',
        total_cost_usd: 0.004,
      })}\n`,
    })
    sink({ kind: 'finished' })
  }

  async cancel(): Promise<void> {
    this.cancelled = true
  }
}
