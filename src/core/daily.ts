/**
 * Daily notes.
 *
 * A daily note is an ordinary note at a predictable path, so nothing special
 * happens to it on disk and it exports like anything else.
 */

import { createNoteFile } from './note'
import { safeFolderPath } from './slug'

/** `2026-09-15` in the *local* time zone (not UTC -- a daily note is local). */
export function localDateKey(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function parseDateKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key.trim())
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? null : date
}

/** Vault-relative path for a given day, e.g. `daily/2026-09-15.md`. */
export function dailyNotePath(date: Date = new Date(), folder = 'daily'): string {
  const clean = safeFolderPath(folder)
  const file = `${localDateKey(date)}.md`
  return clean ? `${clean}/${file}` : file
}

const WEEKDAYS = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota']

/** Genitive, because Czech dates read "15. září", not "15. září" nominative. */
const MONTHS = [
  'ledna', 'února', 'března', 'dubna', 'května', 'června',
  'července', 'srpna', 'září', 'října', 'listopadu', 'prosince',
]

/** Human title, e.g. `úterý 15. září 2026`. */
export function dailyNoteTitle(date: Date = new Date()): string {
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()}. ${MONTHS[date.getMonth()]} ${date.getFullYear()}`
}

/** File text for a brand-new daily note. */
export function dailyNoteTemplate(date: Date = new Date(), random?: () => number): string {
  const key = localDateKey(date)
  const yesterday = new Date(date)
  yesterday.setDate(yesterday.getDate() - 1)
  const tomorrow = new Date(date)
  tomorrow.setDate(tomorrow.getDate() + 1)

  const body = [
    `# ${dailyNoteTitle(date)}`,
    '',
    `#daily`,
    '',
    `[[${localDateKey(yesterday)}|Včera]] - [[${localDateKey(tomorrow)}|Zítra]]`,
    '',
    '## Dnes',
    '',
    '- [ ] ',
    '',
    '## Poznámky',
    '',
    '',
  ].join('\n')

  return createNoteFile({
    title: key,
    body,
    tags: ['daily'],
    now: date,
    ...(random ? { random } : {}),
  })
}
