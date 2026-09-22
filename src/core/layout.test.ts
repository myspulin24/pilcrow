import { describe, expect, it } from 'vitest'

import {
  clampSectionHeight,
  clampSidebarWidth,
  clampWorkspaceWidth,
  SECTION_FILES,
  SECTION_GIT,
  SECTION_HEIGHT_MAX,
  SECTION_HEIGHT_MIN,
  SECTION_NOTES,
  SECTION_RUNS,
  sectionHeight,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  withSectionHeight,
  WORKSPACE_WIDTH_DEFAULT,
  WORKSPACE_WIDTH_MAX,
  WORKSPACE_WIDTH_MIN,
} from './layout'

describe('clampWorkspaceWidth', () => {
  it('rozumnou šířku nechá být', () => {
    expect(clampWorkspaceWidth(300)).toBe(300)
    expect(clampWorkspaceWidth(WORKSPACE_WIDTH_MIN)).toBe(WORKSPACE_WIDTH_MIN)
    expect(clampWorkspaceWidth(WORKSPACE_WIDTH_MAX)).toBe(WORKSPACE_WIDTH_MAX)
  })

  it('drží meze -- nastavení se dá přenést i na menší obrazovku', () => {
    expect(clampWorkspaceWidth(50)).toBe(WORKSPACE_WIDTH_MIN)
    expect(clampWorkspaceWidth(5000)).toBe(WORKSPACE_WIDTH_MAX)
  })

  it('švihnutí myší za levý okraj končí na minimu, ne na výchozí šířce', () => {
    // Záporná hodnota při tažení je běžná; skok zpátky na 300 by vypadal
    // jako by se úchyt utrhl.
    expect(clampWorkspaceWidth(-10)).toBe(WORKSPACE_WIDTH_MIN)
    expect(clampWorkspaceWidth(-5000)).toBe(WORKSPACE_WIDTH_MIN)
  })

  it('nevyplněné nebo poškozené nastavení spadne na výchozí šířku', () => {
    // Nula znamená „nikdo to nenastavil“; sloupec se kvůli tomu nesmí schovat.
    for (const bad of [0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(clampWorkspaceWidth(bad), String(bad)).toBe(WORKSPACE_WIDTH_DEFAULT)
    }
  })

  it('zaokrouhluje -- šířka jde do CSS v celých bodech', () => {
    expect(clampWorkspaceWidth(300.4)).toBe(300)
    expect(clampWorkspaceWidth(300.6)).toBe(301)
  })
})

describe('clampSidebarWidth', () => {
  it('má vlastní meze, ne ty od vedlejšího sloupce', () => {
    expect(clampSidebarWidth(300)).toBe(300)
    expect(clampSidebarWidth(20)).toBe(SIDEBAR_WIDTH_MIN)
    expect(clampSidebarWidth(5000)).toBe(SIDEBAR_WIDTH_MAX)
    // Kdyby se obě šířky ořezávaly stejně, tenhle rozdíl by zmizel.
    expect(clampSidebarWidth(5000)).not.toBe(clampWorkspaceWidth(5000))
  })

  it('nevyplněné nastavení spadne na výchozí šířku, tažení za okraj na minimum', () => {
    expect(clampSidebarWidth(0)).toBe(SIDEBAR_WIDTH_DEFAULT)
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_WIDTH_DEFAULT)
    expect(clampSidebarWidth(-40)).toBe(SIDEBAR_WIDTH_MIN)
  })
})

describe('clampSectionHeight', () => {
  it('rozumnou výšku nechá být a drží meze', () => {
    expect(clampSectionHeight(240)).toBe(240)
    expect(clampSectionHeight(10)).toBe(SECTION_HEIGHT_MIN)
    expect(clampSectionHeight(99999)).toBe(SECTION_HEIGHT_MAX)
  })

  it('nula i nesmysl znamenají „podle obsahu“, ne výchozí výšku', () => {
    // Tady je nula plnohodnotná hodnota, na rozdíl od šířky sloupce:
    // blok bez nastavené výšky roste obsahem, a to je správné chování.
    for (const none of [0, -50, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(clampSectionHeight(none), String(none)).toBe(0)
    }
  })
})

describe('sectionHeight a withSectionHeight', () => {
  it('chybějící klíč je nula, uložený se vrátí v mezích', () => {
    expect(sectionHeight(undefined, SECTION_NOTES)).toBe(0)
    expect(sectionHeight({}, SECTION_NOTES)).toBe(0)
    expect(sectionHeight({ [SECTION_NOTES]: 240 }, SECTION_NOTES)).toBe(240)
    expect(sectionHeight({ [SECTION_NOTES]: 5 }, SECTION_NOTES)).toBe(SECTION_HEIGHT_MIN)
  })

  it('zápis nemění původní objekt', () => {
    const before = { [SECTION_NOTES]: 200 }
    const after = withSectionHeight(before, SECTION_FILES, 300)
    expect(before).toEqual({ [SECTION_NOTES]: 200 })
    expect(after).toEqual({ [SECTION_NOTES]: 200, [SECTION_FILES]: 300 })
  })

  it('nula klíč vyhodí, ať se v nastavení nehromadí prázdno', () => {
    const before = { [SECTION_NOTES]: 200, [SECTION_GIT]: 150 }
    expect(withSectionHeight(before, SECTION_NOTES, 0)).toEqual({ [SECTION_GIT]: 150 })
    expect(withSectionHeight(undefined, SECTION_RUNS, 0)).toEqual({})
  })

  it('bloky se navzájem neovlivňují', () => {
    let heights = withSectionHeight({}, SECTION_NOTES, 240)
    heights = withSectionHeight(heights, SECTION_FILES, 320)
    heights = withSectionHeight(heights, SECTION_GIT, 180)
    heights = withSectionHeight(heights, SECTION_RUNS, 140)
    expect(heights).toEqual({ notes: 240, files: 320, git: 180, runs: 140 })

    heights = withSectionHeight(heights, SECTION_FILES, 0)
    expect(heights).toEqual({ notes: 240, git: 180, runs: 140 })
  })
})
