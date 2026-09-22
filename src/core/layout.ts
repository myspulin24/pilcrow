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

// -- výšky jednotlivých bloků -------------------------------------------------

/**
 * Bloky v levém sloupci, kterým jde nastavit výška.
 *
 * Klíče jdou do nastavení, takže se nesmí měnit -- uživateli by se tím
 * ztratilo, co si nastavil. Přidávat nové je v pořádku.
 */
export const SECTION_NOTES = 'notes'
/**
 * Předpona klíče pro blok se složkou.
 *
 * Od 0.10 je otevřených složek víc, takže samotné `files` nestačí -- klíč
 * dostane ještě cestu složky, viz `folderSectionKey`. Uložené výšky z dřívějška
 * se tím přestanou používat; je to jedna hodnota, ne data.
 */
export const SECTION_FILES = 'files'
export const SECTION_GIT = 'git'
export const SECTION_RUNS = 'runs'

export const SECTION_HEIGHT_MIN = 80
export const SECTION_HEIGHT_MAX = 1200

/**
 * Výška jednoho bloku, nebo `0` pro „podle obsahu“.
 *
 * Nula je plnohodnotná hodnota, ne chybějící: znamená, že si blok výšku
 * neurčuje a roste podle toho, co v něm je -- tak se aplikace chovala vždycky
 * a tak se chová, dokud za okraj nikdo nezatáhne. Proto se nedá říct „nula
 * je nesmysl, dej výchozí“ jako u šířky sloupce.
 */
export function clampSectionHeight(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.min(SECTION_HEIGHT_MAX, Math.max(SECTION_HEIGHT_MIN, Math.round(value)))
}

/** Uložená výška bloku. `0` = podle obsahu. */
export function sectionHeight(heights: Record<string, number> | undefined, key: string): number {
  return clampSectionHeight(heights?.[key] ?? 0)
}

/**
 * Nastavení s novou výškou bloku.
 *
 * Vrací nový objekt; nula klíč rovnou vyhodí, aby se v nastavení nehromadily
 * bloky, kterým uživatel výšku zrušil.
 */
export function withSectionHeight(
  heights: Record<string, number> | undefined,
  key: string,
  value: number,
): Record<string, number> {
  const next = { ...(heights ?? {}) }
  const height = clampSectionHeight(value)
  if (height === 0) delete next[key]
  else next[key] = height
  return next
}
