/**
 * Otevřené složky v levém sloupci.
 *
 * Do 0.9 byla otevřená vždycky nejvýš jedna. Od 0.10 jich může být víc naráz
 * a jedna z nich je *aktivní* -- ta, ke které se vztahuje sekce Git. Celá
 * aplikace pracuje se stavem gitu pro jednu složku, takže aktivní složka není
 * kosmetika, ale jediné místo, kde se rozhoduje, čí větev, čí změny a čí
 * pull request jsou zrovna vidět.
 *
 * Tady bydlí rozhodování, ne data: co se stane při otevření složky, která už
 * otevřená je, kam se skočí po zavření aktivní složky a do které ze složek
 * patří daný soubor. Stromy načítá `store`, kreslí je `Workspace`.
 */

import { toRepoRelative } from './git'
import { SECTION_FILES } from './layout'
import type { TreeNode } from './tree'

/** Jedna otevřená složka i s tím, co se z ní načetlo. */
export interface OpenFolder {
  /** Absolutní cesta ke kořeni. Zároveň identita složky. */
  rootPath: string
  tree: TreeNode | null
  fileCount: number
  folderCount: number
  /** Průchod narazil na strop hloubky nebo počtu souborů. */
  truncated: boolean
  /** Cesty rozbalených podsložek. */
  expanded: string[]
  /** Rozbalený blok v levém sloupci. Neukládá se, po startu je otevřený. */
  open: boolean
  loading: boolean
  error: string | null
}

export const MAX_OPEN_FOLDERS = 8

export function emptyFolder(rootPath: string): OpenFolder {
  return {
    rootPath,
    tree: null,
    fileCount: 0,
    folderCount: 0,
    truncated: false,
    expanded: [],
    open: true,
    loading: false,
    error: null,
  }
}

/**
 * Jsou to tytéž cesty?
 *
 * Na Windows bez ohledu na velikost písmen a na směr lomítek: `C:\Users\a`
 * z dialogu a `c:/users/a` z nastavení jsou jedna složka a otevřít se má
 * jednou.
 */
export function sameFolder(a: string, b: string): boolean {
  const clean = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '')
  const left = clean(a)
  const right = clean(b)
  if (/^[a-z]:\//i.test(left) || /^[a-z]:\//i.test(right)) {
    return left.toLowerCase() === right.toLowerCase()
  }
  return left === right
}

export function findFolder(folders: readonly OpenFolder[], rootPath: string): OpenFolder | null {
  return folders.find((folder) => sameFolder(folder.rootPath, rootPath)) ?? null
}

/** Aktivní složka, nebo `null`, když žádná otevřená není. */
export function activeFolder(
  folders: readonly OpenFolder[],
  activePath: string | null,
): OpenFolder | null {
  if (!activePath) return null
  return findFolder(folders, activePath)
}

/**
 * Přidat složku, nebo nahradit tu, která už otevřená je.
 *
 * Otevřít podruhé tutéž složku není chyba ani druhý blok ve sloupci: je to
 * obyčejné načtení znovu. Nová složka jde na konec, aby pořadí odpovídalo
 * tomu, jak je uživatel otevíral.
 */
export function withFolder(folders: readonly OpenFolder[], next: OpenFolder): OpenFolder[] {
  const index = folders.findIndex((folder) => sameFolder(folder.rootPath, next.rootPath))
  if (index === -1) return [...folders, next]
  const updated = [...folders]
  updated[index] = next
  return updated
}

/** Změnit jednu složku na místě. Neznámá cesta nechá seznam být. */
export function patchFolder(
  folders: readonly OpenFolder[],
  rootPath: string,
  patch: Partial<OpenFolder>,
): OpenFolder[] {
  return folders.map((folder) =>
    sameFolder(folder.rootPath, rootPath) ? { ...folder, ...patch } : folder,
  )
}

export function withoutFolder(folders: readonly OpenFolder[], rootPath: string): OpenFolder[] {
  return folders.filter((folder) => !sameFolder(folder.rootPath, rootPath))
}

/**
 * Do které otevřené složky soubor patří.
 *
 * Nejdelší shoda vyhrává: když je otevřené repo i jeho podsložka `docs`,
 * soubor z `docs` patří do `docs`. Jinak by se aktivní složka při kliknutí
 * měnila podle toho, v jakém pořadí se složky otevíraly.
 */
export function folderOf(folders: readonly OpenFolder[], filePath: string): OpenFolder | null {
  let best: OpenFolder | null = null
  for (const folder of folders) {
    if (toRepoRelative(folder.rootPath, filePath) === null) continue
    if (!best || folder.rootPath.length > best.rootPath.length) best = folder
  }
  return best
}

/**
 * Která složka bude aktivní po zavření `closing`.
 *
 * Sousední, ne první: zavřít prostřední složku a skočit tím na úplně jinou
 * část sloupce je překvapení. Když se zavírá složka, která aktivní nebyla,
 * aktivní zůstává ta dosavadní.
 */
export function activeAfterClose(
  folders: readonly OpenFolder[],
  closing: string,
  activePath: string | null,
): string | null {
  if (activePath && !sameFolder(activePath, closing)) {
    return findFolder(folders, activePath) ? activePath : null
  }
  const index = folders.findIndex((folder) => sameFolder(folder.rootPath, closing))
  if (index === -1) return activePath
  const rest = withoutFolder(folders, closing)
  const next = rest[index] ?? rest[rest.length - 1]
  return next ? next.rootPath : null
}

/** Poslední úsek cesty -- jméno složky, jak se ukazuje v hlavičce bloku. */
export function folderLabel(rootPath: string): string {
  return rootPath.split(/[\\/]/).filter(Boolean).pop() ?? rootPath
}

/**
 * Klíč výšky bloku pro jednu složku.
 *
 * S víc složkami naráz nemůže být výška uložená pod jedním klíčem `files`:
 * roztáhnout jeden strom by roztáhlo všechny. Klíč nese cestu, takže si
 * každá složka drží svou -- a když se složka zavře a otevře, výška platí dál.
 */
export function folderSectionKey(rootPath: string): string {
  return `${SECTION_FILES}:${rootPath.replace(/\\/g, '/').replace(/\/+$/, '')}`
}

/**
 * Cesty do nastavení: co se má po startu otevřít znovu.
 *
 * Aktivní složka jde první, aby ji uměla obnovit i starší verze aplikace,
 * která zná jenom `lastFolder`.
 */
export function foldersToRemember(
  folders: readonly OpenFolder[],
  activePath: string | null,
): string[] {
  const paths = folders.map((folder) => folder.rootPath)
  if (!activePath) return paths.slice(0, MAX_OPEN_FOLDERS)
  const rest = paths.filter((path) => !sameFolder(path, activePath))
  return [activePath, ...rest].slice(0, MAX_OPEN_FOLDERS)
}

/**
 * Co po startu otevřít, ze starého i nového nastavení.
 *
 * `openFolders` přibylo v 0.10; `lastFolder` umí i verze před ní. Kdo se
 * vrátí ke starší verzi, přijde o seznam, ne o poslední složku.
 */
export function foldersToRestore(settings: {
  openFolders?: string[]
  lastFolder?: string
}): string[] {
  const listed = settings.openFolders ?? []
  const all = [...listed, ...(settings.lastFolder ? [settings.lastFolder] : [])]
  const unique: string[] = []
  for (const path of all) {
    if (!path.trim()) continue
    if (unique.some((seen) => sameFolder(seen, path))) continue
    unique.push(path)
  }
  return unique.slice(0, MAX_OPEN_FOLDERS)
}
