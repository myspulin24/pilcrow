/**
 * Porovnávání verzí a formátování postupu stahování.
 *
 * Čistá logika aktualizací: jestli je nabízená verze opravdu novější, kolik
 * procent už je stažených a jak ta čísla napsat česky. Stahování ani
 * instalace tady nejsou -- ty patří do `src/updater`.
 *
 * Verze se čtou podle sémantického verzování, protože tak je vydává GitHub
 * i Tauri. Předverze (`0.2.0-beta.1`) je vždycky starší než stejná verze bez
 * přípony, takže beta nikdy nepřepíše finální vydání.
 */

import { withCount } from './messages'

export interface Version {
  major: number
  minor: number
  patch: number
  /** Části za pomlčkou, například `beta.1` → `['beta', 1]`. Prázdné u finální verze. */
  prerelease: Array<string | number>
}

const SEMVER =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/**
 * Rozebrat verzi. Vrací `null` na čemkoli, co není semver -- volající se pak
 * rozhodne sám, místo aby dostal tiše nesmyslné číslo.
 */
export function parseVersion(text: string): Version | null {
  const match = SEMVER.exec((text ?? '').trim())
  if (!match) return null
  const prerelease = match[4]
    ? match[4].split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part))
    : []
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease,
  }
}

/** Porovnat části předverze podle pravidel semveru. */
function comparePrerelease(a: Array<string | number>, b: Array<string | number>): number {
  // Finální verze je vždy novější než jakákoli její předverze.
  if (a.length === 0 && b.length === 0) return 0
  if (a.length === 0) return 1
  if (b.length === 0) return -1

  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const left = a[i]
    const right = b[i]
    if (left === undefined) return -1
    if (right === undefined) return 1
    if (left === right) continue
    // Číslo je vždy nižší než text (semver 11.4.4).
    const leftIsNumber = typeof left === 'number'
    const rightIsNumber = typeof right === 'number'
    if (leftIsNumber && rightIsNumber) return left < right ? -1 : 1
    if (leftIsNumber) return -1
    if (rightIsNumber) return 1
    return String(left) < String(right) ? -1 : 1
  }
  return 0
}

/** `-1` když je `a` starší, `0` když jsou stejné, `1` když je `a` novější. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  // Co se nedá přečíst, nikdy nevyhraje: neznámá verze se tváří jako starší.
  if (!left && !right) return 0
  if (!left) return -1
  if (!right) return 1

  if (left.major !== right.major) return left.major < right.major ? -1 : 1
  if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1
  if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1
  return comparePrerelease(left.prerelease, right.prerelease)
}

/**
 * Je `candidate` novější než `current`?
 *
 * Tohle je poslední pojistka před stažením: server může nabídnout cokoli, ale
 * downgrade ani stejnou verzi aplikace nikdy nenainstaluje sama od sebe.
 */
export function isNewer(candidate: string, current: string): boolean {
  if (!parseVersion(candidate)) return false
  return compareVersions(candidate, current) > 0
}

/** Kolik procent je staženo, nebo `null`, když server nehlásí celkovou velikost. */
export function downloadPercent(downloaded: number, total: number | null): number | null {
  if (total === null || !Number.isFinite(total) || total <= 0) return null
  const ratio = downloaded / total
  return Math.max(0, Math.min(100, Math.round(ratio * 100)))
}

const UNITS = ['B', 'kB', 'MB', 'GB'] as const

/** Velikost v bajtech česky, s desetinnou čárkou. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  // Bajty jsou vždy celé číslo, větší jednotky na jedno desetinné místo.
  const rounded = unit === 0 ? String(Math.round(value)) : value.toFixed(1).replace('.', ',')
  return `${rounded} ${UNITS[unit]}`
}

/** `1,2 MB z 4,7 MB`, nebo jen staženo, když celek neznáme. */
export function formatProgress(downloaded: number, total: number | null): string {
  if (total === null || total <= 0) return formatBytes(downloaded)
  return `${formatBytes(downloaded)} z ${formatBytes(total)}`
}

/**
 * Datum vydání česky.
 *
 * Server posílá ISO 8601 v UTC (`2026-09-19T07:45:16.633Z`). To je správný
 * formát pro přenos a mizerný pro čtení -- a navíc ukazuje jiný čas, než jaký
 * byl na hodinách toho, kdo se dívá. Převádí se proto do místního času
 * a českého zápisu: `19. 9. 2026 v 9:45`.
 *
 * Nečitelné datum vrátí prázdný řetězec, ne `Invalid Date`. Okno pak řádku
 * s datem vynechá; chybějící údaj je lepší než nesmysl.
 */
export function formatReleaseDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''

  const day = date.getDate()
  const month = date.getMonth() + 1
  const year = date.getFullYear()
  const hours = date.getHours()
  const minutes = String(date.getMinutes()).padStart(2, '0')

  return `${day}. ${month}. ${year} v ${hours}:${minutes}`
}

/**
 * Poznámky k vydání zkrácené na pár řádků.
 *
 * GitHub do nich přidává patičku „Full Changelog: ...“ a seznam přispěvatelů;
 * v okně aktualizace zabírají místo a nic neříkají, takže jdou pryč.
 */
export function summariseNotes(notes: string, maxLines = 12): string {
  const lines = (notes ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line, index, all) => {
      if (/^\*\*Full Changelog\*\*:/i.test(line)) return false
      if (/^Full Changelog:/i.test(line)) return false
      // Zahodit víc než jeden prázdný řádek za sebou.
      return !(line === '' && all[index - 1] === '')
    })

  while (lines.length > 0 && lines[0] === '') lines.shift()
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

  if (lines.length <= maxLines) return lines.join('\n')
  const shown = lines.slice(0, maxLines)
  const hidden = lines.length - maxLines
  shown.push('', `… a ${withCount(hidden, 'další řádek', 'další řádky', 'dalších řádků')}`)
  return shown.join('\n')
}
