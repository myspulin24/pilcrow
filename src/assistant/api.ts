/**
 * Hranice asistenta.
 *
 * Stejný vzor jako u `VaultApi` a `UpdaterApi`: jedno rozhraní, dvě skutečné
 * implementace.
 *
 *   - `TauriAssistant`  - opravdová: spustí na tvém počítači `claude`,
 *     který je přihlášený k tvému předplatnému.
 *   - `MemoryAssistant` - stejná sémantika bez procesu, pro `npm run dev:web`
 *     a pro testy. Není to atrapa: hlídá stejné pořadí kroků (nejdřív
 *     nainstalovat, pak přihlásit, teprve pak se ptát) a streamuje odpověď
 *     po kouscích jako ta pravá.
 *
 * Jedna věc je tu jiná než všude jinde v Reader_MJ a patří to říct nahlas:
 * **text poznámky odchází z počítače k Anthropicu.** Všechno ostatní zůstává
 * u tebe. Proto je asistent vypnutý, dokud ho někdo vědomě nezapne.
 */

/** Kus výstupu z běžícího procesu, tak jak přišel. */
export type AssistantChunk =
  | { kind: 'out'; text: string }
  | { kind: 'finished' }
  | { kind: 'failed'; message: string }

export type AssistantSink = (chunk: AssistantChunk) => void

export interface AskInput {
  /** Hotová zpráva pro Clauda -- poznámka i otázka. Skládá ji `buildQuestion`. */
  prompt: string
  /** Systémový pokyn, který se přidá k výchozímu. */
  system: string
  /** Sezení, ve kterém se pokračuje. `null` začíná nový rozhovor. */
  sessionId: string | null
  /** `opus`, `sonnet`, nebo plné jméno modelu. */
  model: string | null
}

/** Co Rust zjistil o Claude Code na tomhle počítači. */
export interface ProbeResult {
  installed: boolean
  version: string
  path: string
  /** Surový JSON z `claude auth status --json`. Rozumí mu `@/core`. */
  auth: string
  error: string
}

export interface AssistantApi {
  /**
   * Dá se na tomhle sestavení asistent vůbec spustit?
   *
   * `false` v prohlížeči: spouštět procesy jde jen z desktopové aplikace.
   * UI pak místo nefunkčního tlačítka řekne proč.
   */
  readonly available: boolean

  /** Je nainstalováno, je přihlášeno, a pod jakým účtem. */
  probe(): Promise<ProbeResult>

  /** Přesný příkaz, který instalace spustí. UI ho ukáže dřív, než se klikne. */
  installCommand(): Promise<string>

  /**
   * Doinstalovat Claude Code oficiálním skriptem Anthropicu.
   *
   * Průběh chodí do `sink`, aby bylo vidět, co se děje, a hlavně co se
   * pokazilo. Instalace se schválně nedá přerušit.
   */
  install(sink: AssistantSink): Promise<void>

  /**
   * Spustit přihlášení k předplatnému.
   *
   * Otevře prohlížeč a čeká na kód, který se v něm objeví. Ten se pošle
   * přes `loginCode`. Reader_MJ ho nikam neukládá -- jen ho podá dál.
   */
  login(sink: AssistantSink): Promise<void>
  loginCode(code: string): Promise<void>
  loginCancel(): Promise<void>

  /** Odhlásit se. Přihlášení patří Claude Code, ne nám, takže tohle jen zavolá jeho. */
  logout(): Promise<void>

  /** Zeptat se. Odpověď chodí po kouscích do `sink`. */
  ask(input: AskInput, sink: AssistantSink): Promise<void>

  /** Zastavit rozepsanou odpověď. */
  cancel(): Promise<void>
}

export interface AssistantFailure {
  message: string
}

export function isAssistantFailure(value: unknown): value is AssistantFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    typeof (value as AssistantFailure).message === 'string'
  )
}

/** Vytáhnout z čehokoli chybovou větu, kterou jde ukázat člověku. */
export function assistantMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) return error
  if (error instanceof Error && error.message) return error.message
  if (isAssistantFailure(error) && error.message.trim()) return error.message
  return fallback
}
