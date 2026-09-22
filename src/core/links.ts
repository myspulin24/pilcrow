/**
 * Poznámka, která je odkazem na soubor jinde v počítači.
 *
 * Soubor v repozitáři nechceme kopírovat do trezoru: byl by dvakrát a jedna
 * z kopií by hned zastarala. Zároveň je praktické mít ho mezi poznámkami --
 * kvůli hledání, štítkům a tomu, že se na něj dá odkazovat.
 *
 * Řešení je poznámka, ve které není text souboru, ale cesta k němu:
 *
 *     ---
 *     id: ...
 *     title: README.md
 *     tags: [dokumentace]
 *     source: "C:\\dev\\repo\\README.md"
 *     ---
 *
 * Otevřít takovou poznámku znamená otevřít ten soubor -- edituje se přímo on,
 * jako by se otevřel ve stromu. Štítky, název a připnutí zůstávají v trezoru,
 * takže se do cizího repozitáře nezapisuje nic, co tam nepatří.
 *
 * `source` je obyčejný klíč ve frontmatteru, který Pilcrow sám nezná; formát
 * poznámky se kvůli tomu nemusel měnit a čitelný zůstane i bez Pilcrow.
 */

import { serializeNote } from './frontmatter'
import { normalizeTag } from './tags'
import type { NoteFrontmatter, ParsedNote } from './types'

/** Klíč ve frontmatteru. Mění se jen s přechodem na jiný formát poznámek. */
export const LINK_KEY = 'source'

/** Cesta k odkazovanému souboru, nebo `null` u obyčejné poznámky. */
export function linkedSource(note: { frontmatter: NoteFrontmatter } | null | undefined): string | null {
  const value = note?.frontmatter.extra[LINK_KEY]?.trim()
  return value ? value : null
}

export function isLinkedNote(note: { frontmatter: NoteFrontmatter } | null | undefined): boolean {
  return linkedSource(note) !== null
}

/** Text poznámky-odkazu, jak se zapíše do trezoru. */
export function buildLinkedNote(input: {
  source: string
  title: string
  id: string
  now: string
  /** Tělo. Ukáže se jako úryvek v seznamu poznámek; soubor se jím nemění. */
  body: string
}): string {
  const frontmatter: NoteFrontmatter = {
    id: input.id,
    title: input.title,
    created: input.now,
    updated: input.now,
    pinned: false,
    tags: [],
    extra: { [LINK_KEY]: input.source },
  }
  return serializeNote(frontmatter, input.body)
}

/**
 * Nahradit štítky poznámky.
 *
 * Do frontmatteru, ne do těla: u poznámky-odkazu je tělo jen popisek a
 * skutečný obsah leží v cizím souboru, do kterého Pilcrow štítky psát nesmí.
 * Prázdné a poškozené se zahodí, pořadí se zachová a nic se neopakuje.
 */
export function withTags(note: ParsedNote, tags: string[], now: Date = new Date()): ParsedNote {
  const clean: string[] = []
  for (const tag of tags) {
    const normalised = normalizeTag(tag)
    if (!normalised || clean.includes(normalised)) continue
    clean.push(normalised)
  }
  return {
    ...note,
    frontmatter: { ...note.frontmatter, tags: clean, updated: now.toISOString() },
  }
}

/**
 * Štítky z textu, jak je člověk napíše: mezerami nebo čárkami, s mřížkou i bez.
 */
export function parseTagInput(input: string): string[] {
  return input
    .split(/[,\s]+/)
    .map((part) => normalizeTag(part))
    .filter((part, index, all): part is string => part !== '' && all.indexOf(part) === index)
}
