import { describe, expect, it } from 'vitest'

import {
  clampWorkspaceWidth,
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
