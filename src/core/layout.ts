/**
 * Rozměry rozvržení, které si uživatel nastavuje sám.
 *
 * Meze jsou tu proto, že šířka jde do nastavení a nastavení se dá upravit
 * ručně i přenést z jiného počítače s menší obrazovkou. Sloupec širší než
 * okno by schoval poznámku, užší než 200 bodů by neuživil ani strom souborů.
 */

export const WORKSPACE_WIDTH_MIN = 200
export const WORKSPACE_WIDTH_MAX = 720
export const WORKSPACE_WIDTH_DEFAULT = 300

/**
 * Šířka levého sloupce v mezích.
 *
 * Dvě různé situace, které se nesmí plést dohromady:
 *
 *  - **Nevyplněno nebo nesmysl** (nula, `NaN`, nekonečno) -- to je nastavení,
 *    které nikdo nenastavil nebo které se cestou poškodilo. Platí výchozí
 *    šířka, protože jiná volba by byla hádání.
 *  - **Táhnutí za okraj** -- záporná hodnota vznikne úplně běžně, když
 *    uživatel švihne myší doleva. Tam je správná odpověď minimum, ne skok
 *    zpátky na výchozí šířku.
 */
export function clampWorkspaceWidth(value: number): number {
  if (!Number.isFinite(value) || value === 0) return WORKSPACE_WIDTH_DEFAULT
  return Math.min(WORKSPACE_WIDTH_MAX, Math.max(WORKSPACE_WIDTH_MIN, Math.round(value)))
}
