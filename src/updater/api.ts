/**
 * Hranice aktualizací.
 *
 * Stejný vzor jako u `VaultApi`: jedno rozhraní, dvě skutečné implementace.
 *
 *   - `TauriUpdater`  - opravdová: plugin Tauri, GitHub Releases, ověření podpisu.
 *   - `MemoryUpdater` - stejná sémantika bez sítě, pro `npm run dev:web`
 *     a pro testy. Není to atrapa: hlídá stejné pořadí kroků a stejná
 *     pravidla (novější verze, stažení před instalací).
 *
 * Díky tomu se celý průběh aktualizace dá projít v testu a v prohlížeči se
 * aplikace chová rozumně místo toho, aby spadla na chybějícím pluginu.
 */

/** Co je k dispozici. Verze jsou semver, poznámky jsou Markdown z GitHubu. */
export interface UpdateInfo {
  /** Verze, kterou nabízí server. */
  version: string
  /** Verze, která právě běží. */
  currentVersion: string
  /** Poznámky k vydání, tak jak je napsal release na GitHubu. */
  notes: string
  /** Datum vydání v ISO, když ho server uvedl. */
  date: string | null
}

export interface DownloadProgress {
  downloaded: number
  /** Celková velikost, nebo `null`, když ji server nehlásí. */
  total: number | null
}

export type UpdaterErrorKind =
  /** Běží prohlížeč nebo build bez pluginu -- aktualizovat prostě nejde. */
  | 'unavailable'
  /** Na server se nedá dosáhnout. */
  | 'network'
  /** Balíček není podepsaný naším klíčem, nebo je poškozený. */
  | 'signature'
  /** Cokoli jiného. */
  | 'other'

export interface UpdaterError {
  kind: UpdaterErrorKind
  message: string
}

export function updaterError(kind: UpdaterErrorKind, message: string): UpdaterError {
  return { kind, message }
}

export function isUpdaterError(value: unknown): value is UpdaterError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    'message' in value &&
    typeof (value as UpdaterError).message === 'string'
  )
}

export interface UpdaterApi {
  /**
   * Jde na tomhle sestavení vůbec aktualizovat?
   *
   * `false` v prohlížeči. UI pak tlačítko „Zkontrolovat aktualizace“ vůbec
   * neukáže, místo aby nabízelo něco, co skončí chybou.
   */
  readonly available: boolean

  /** Verze, která právě běží. */
  currentVersion(): Promise<string>

  /**
   * Smí se po startu kontrolovat samo?
   *
   * Vypíná se `PILCROW_AUTO_UPDATE=0` v `.env`. Ruční kontrola tím dotčená
   * není -- vypíná se jen to, co se děje bez zeptání.
   */
  autoCheckEnabled(): Promise<boolean>

  /** Podívat se na server. `null` znamená, že nic novějšího není. */
  check(): Promise<UpdateInfo | null>

  /**
   * Stáhnout to, co vrátil poslední `check()`, a ověřit podpis.
   *
   * Bez předchozího úspěšného `check()` je to chyba: stahovat se smí jen to,
   * co bylo nabídnuto a uznáno za novější.
   *
   * Stahování je oddělené od instalace schválně. Stáhnout se dá na pozadí,
   * zatímco uživatel píše; instalace zavře okno, takže si o ni musí říct.
   */
  download(onProgress?: (progress: DownloadProgress) => void): Promise<void>

  /**
   * Nainstalovat stažený balíček.
   *
   * Na Windows tím převezme řízení instalátor a aplikace se zavře, takže
   * tohle je poslední věc, kterou stihne udělat. Volej až po `download()`.
   */
  install(): Promise<void>

  /** Restartovat aplikaci do nové verze. */
  relaunch(): Promise<void>
}
