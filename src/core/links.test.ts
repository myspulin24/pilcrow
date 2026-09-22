import { describe, expect, it } from 'vitest'

import { buildLinkedNote, isLinkedNote, linkedSource, parseTagInput, withTags } from './links'
import { parseNote } from './note'

const WINDOWS_PATH = 'C:\\Users\\micha\\dev\\repo\\README.md'

function linked(source = WINDOWS_PATH) {
  return buildLinkedNote({
    source,
    title: 'README.md',
    id: 'seed0001link',
    now: '2026-09-22T10:00:00.000Z',
    body: `Odkaz na soubor ${source}\n`,
  })
}

describe('poznámka-odkaz', () => {
  it('nese cestu k souboru a přežije zápis i načtení', () => {
    const parsed = parseNote(linked(), { path: 'README.md' })
    expect(linkedSource(parsed)).toBe(WINDOWS_PATH)
    expect(isLinkedNote(parsed)).toBe(true)
  })

  it('zpětná lomítka ve windowsové cestě se cestou neztratí', () => {
    // Uvozovky a zdvojená lomítka píše zápis frontmatteru; načtení je vrátí
    // zpátky. Kdyby ne, ukazoval by odkaz na cestu, která neexistuje.
    const text = linked()
    expect(text).toContain('source: "C:\\\\Users\\\\micha\\\\dev\\\\repo\\\\README.md"')
    expect(linkedSource(parseNote(text, { path: 'README.md' }))).toBe(WINDOWS_PATH)
  })

  it('unixová cesta se nezmění', () => {
    const parsed = parseNote(linked('/home/micha/repo/README.md'), { path: 'README.md' })
    expect(linkedSource(parsed)).toBe('/home/micha/repo/README.md')
  })

  it('obyčejná poznámka odkaz není', () => {
    const parsed = parseNote('# Poznámka\n\nText.\n', { path: 'poznamka.md' })
    expect(linkedSource(parsed)).toBeNull()
    expect(isLinkedNote(parsed)).toBe(false)
  })

  it('prázdný `source` se bere jako žádný', () => {
    const parsed = parseNote('---\nsource: ""\n---\n\nText.\n', { path: 'a.md' })
    expect(linkedSource(parsed)).toBeNull()
  })

  it('tělo je jen popisek do seznamu, cesta je ve frontmatteru', () => {
    const parsed = parseNote(linked(), { path: 'README.md' })
    expect(parsed.body.trim()).toBe(`Odkaz na soubor ${WINDOWS_PATH}`)
    expect(parsed.frontmatter.title).toBe('README.md')
    expect(parsed.frontmatter.tags).toEqual([])
  })
})

describe('štítky poznámky-odkazu', () => {
  const base = () => parseNote(linked(), { path: 'README.md' })

  it('zapíšou se do frontmatteru, ne do těla', () => {
    const updated = withTags(base(), ['dokumentace', 'repo/blabel'])
    expect(updated.frontmatter.tags).toEqual(['dokumentace', 'repo/blabel'])
    expect(updated.body).toBe(base().body)
  })

  it('cesta k souboru se změnou štítků neztratí', () => {
    const updated = withTags(base(), ['a'])
    expect(linkedSource(updated)).toBe(WINDOWS_PATH)
  })

  it('poškozené a opakované se zahodí, pořadí zůstane', () => {
    const updated = withTags(base(), ['#Dokumentace', 'dokumentace', '', '404', 'Repo/Blabel'])
    expect(updated.frontmatter.tags).toEqual(['dokumentace', 'repo/blabel'])
  })

  it('posune `updated`, aby se poznámka v seznamu vynořila nahoru', () => {
    const updated = withTags(base(), ['a'], new Date('2026-09-22T12:00:00.000Z'))
    expect(updated.frontmatter.updated).toBe('2026-09-22T12:00:00.000Z')
  })
})

describe('psaní štítků', () => {
  it('bere mezery, čárky i mřížky', () => {
    expect(parseTagInput('#dokumentace, repo/blabel  práce')).toEqual([
      'dokumentace',
      'repo/blabel',
      'práce',
    ])
  })

  it('prázdný vstup nedá nic', () => {
    expect(parseTagInput('   ')).toEqual([])
  })

  it('opakované se sloučí', () => {
    expect(parseTagInput('a #a A')).toEqual(['a'])
  })
})
