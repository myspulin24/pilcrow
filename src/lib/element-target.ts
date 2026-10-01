/**
 * Popsat prvek, na který uživatel ve feedbacku ukázal.
 *
 * Dvě věci: lidský popis („tlačítko „Větve…“ · Pracovní plocha › Git“) a cesta
 * pro vývojáře (`section#ws-git > … > button.git__branch-button`).
 *
 * Text prvku se bere jen u ovládacích prvků a nadpisů, a nikdy uvnitř
 * poznámky -- editor, náhled a seznam poznámek nesou to, co uživatel napsal,
 * a to do feedbacku samo od sebe nepatří. Tam se popíše jen *co* to je.
 */

import type { FeedbackElement } from '@/core'

/**
 * Kde začíná obsah, ze kterého se text ani titulek nebere: text poznámky
 * a její název, seznamy poznámek, souborů a skupin, změny v gitu, rozhovor
 * s asistentem -- a hlavičky bloků a stavový řádek, které nesou jméno
 * složky a cesty na disku.
 */
const PRIVATE = [
  'textarea',
  'input',
  '[contenteditable="true"]',
  '.markdown-body',
  '.note-header',
  '.note-list__items',
  '.note-row',
  '.backlinks',
  '.tree',
  '.groups',
  '.git__changes',
  '.git__summary',
  '.assistant__thread',
  '.ws-section__header',
  '.workspace__current',
  '.status-bar__item',
].join(', ')

/** Co je „prvek“, na který má smysl ukázat. */
const MEANINGFUL = 'button, a, input, select, textarea, label, summary, h1, h2, h3, h4, [role], [aria-label], li, section'

const ROLE_LABEL: Record<string, string> = {
  button: 'tlačítko',
  a: 'odkaz',
  link: 'odkaz',
  input: 'pole',
  textbox: 'pole',
  searchbox: 'hledání',
  textarea: 'textové pole',
  select: 'výběr',
  combobox: 'výběr',
  checkbox: 'zaškrtávátko',
  radio: 'volba',
  summary: 'rozbalovací část',
  h1: 'nadpis',
  h2: 'nadpis',
  h3: 'nadpis',
  h4: 'nadpis',
  heading: 'nadpis',
  li: 'položka',
  listitem: 'položka',
  dialog: 'okno',
  alertdialog: 'okno',
  section: 'oddíl',
  region: 'oblast',
  navigation: 'panel',
  toolbar: 'lišta',
  tree: 'strom',
  treeitem: 'položka stromu',
  list: 'seznam',
  img: 'ikona',
}

function clip(text: string, max = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}

function kindOf(element: Element): string {
  const role = element.getAttribute('role')
  if (role && ROLE_LABEL[role]) return ROLE_LABEL[role]
  if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) {
    return ROLE_LABEL[element.type] ?? 'pole'
  }
  return ROLE_LABEL[element.tagName.toLowerCase()] ?? 'prvek'
}

/**
 * Jméno prvku: popisek, titulek, nebo text.
 *
 * V soukromých oblastech jen `aria-label` -- ten píše aplikace („Text
 * poznámky“). Titulek tam nese cestu k souboru a text obsah poznámky.
 */
function nameOf(element: Element): string {
  const aria = element.getAttribute('aria-label') ?? ''
  if (element.closest(PRIVATE)) return clip(aria)
  // Co je na prvku vidět, má přednost před bublinou: uživatel zná tlačítko
  // „Nastavení“, ne „Vzhled, chování a informace o aplikaci“.
  return clip(aria) || clip(element.textContent ?? '') || clip(element.getAttribute('title') ?? '')
}

/** Jméno bloku v levém sloupci. Složka se nejmenuje -- její jméno je cizí věc. */
function sectionName(section: Element): string {
  if (section.id === 'ws-git') return 'Git'
  if (section.id.startsWith('ws-files')) return 'složka'
  return section.querySelector(':scope > .ws-section__header .ws-section__label')?.textContent ?? ''
}

/** Nejbližší prvek, na který má smysl ukázat. */
export function meaningfulTarget(start: Element): Element {
  return start.closest(MEANINGFUL) ?? start
}

/** Oblasti nad prvkem, od největší: „Pracovní plocha › Git“. */
function areaOf(element: Element): string {
  const names: string[] = []
  let node: Element | null = element.parentElement
  while (node && names.length < 3) {
    if (node.matches('nav[aria-label], [role="dialog"], [role="region"], [aria-label].workspace, section[aria-label]')) {
      const name = node.getAttribute('aria-label') ?? labelledBy(node)
      if (name) names.unshift(clip(name, 40))
    } else if (node.matches('section.ws-section')) {
      // Bloky levého sloupce nemají aria-label -- jméno je v přepínači.
      const title = sectionName(node)
      if (title) names.unshift(clip(title, 40))
    }
    node = node.parentElement
  }
  return names.join(' › ')
}

function labelledBy(element: Element): string {
  const id = element.getAttribute('aria-labelledby')
  return id ? (element.ownerDocument.getElementById(id)?.textContent ?? '') : ''
}

/** Krátká cesta pro vývojáře: tagy, id a první třída, nejvýš pět úrovní. */
function pathOf(element: Element): string {
  const steps: string[] = []
  let node: Element | null = element
  while (node && node !== element.ownerDocument.body && steps.length < 5) {
    let step = node.tagName.toLowerCase()
    if (node.id && !/^:r/.test(node.id)) step += `#${node.id}`
    const first = [...node.classList].find((name) => !name.startsWith('is-'))
    if (first) step += `.${first}`
    steps.unshift(step)
    node = node.parentElement
  }
  return steps.join(' > ')
}

export function describeElement(target: Element): FeedbackElement {
  const element = meaningfulTarget(target)
  const name = nameOf(element)
  const area = areaOf(element)
  const head = name ? `${kindOf(element)} „${name}“` : kindOf(element)
  return { label: area ? `${head} · ${area}` : head, path: pathOf(element) }
}
