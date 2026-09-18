/**
 * Motiv vzhledu.
 *
 * Tři volby, ale jen dva vzhledy: „podle systému“ není třetí paleta, je to
 * rozhodnutí, že si o barvu řekne operační systém. Proto se to tady dělí na
 * dvě funkce -- co si uživatel přeje (`ThemeSetting`) a co z toho vyjde
 * (`Theme`). CSS zná jen to druhé, takže má v souboru se styly jednu paletu
 * a jednu její tmavou variantu, ne tři.
 */

/** Co si uživatel vybral v nastavení. */
export type ThemeSetting = 'system' | 'light' | 'dark'

/** Co se z toho nakonec vykreslí. */
export type Theme = 'light' | 'dark'

export const THEME_SETTINGS: readonly ThemeSetting[] = ['system', 'light', 'dark']

export function isThemeSetting(value: unknown): value is ThemeSetting {
  return typeof value === 'string' && (THEME_SETTINGS as readonly string[]).includes(value)
}

/**
 * Jaký vzhled z volby a systému vyjde.
 *
 * `prefersDark` je to, co říká `prefers-color-scheme`. Neznámá hodnota
 * v nastavení se bere jako „podle systému“: raději se řídit systémem než
 * spadnout na překlepu v ručně upraveném souboru.
 */
export function resolveTheme(setting: unknown, prefersDark: boolean): Theme {
  if (setting === 'light') return 'light'
  if (setting === 'dark') return 'dark'
  return prefersDark ? 'dark' : 'light'
}
