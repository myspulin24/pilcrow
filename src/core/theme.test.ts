import { describe, expect, it } from 'vitest'

import { isThemeSetting, resolveTheme, THEME_SETTINGS } from './theme'

describe('resolveTheme', () => {
  it('výslovná volba přebíjí systém', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('„podle systému“ se řídí systémem', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('nesmyslná hodnota se chová jako „podle systému“', () => {
    // Nastavení se dá upravit ručně; překlep nemá aplikaci rozsvítit
    // natvrdo doběla uprostřed noci.
    for (const bad of [undefined, null, '', 'tmavy', 42, {}]) {
      expect(resolveTheme(bad, true), String(bad)).toBe('dark')
      expect(resolveTheme(bad, false), String(bad)).toBe('light')
    }
  })
})

describe('isThemeSetting', () => {
  it('pozná jen tři platné volby', () => {
    for (const value of THEME_SETTINGS) expect(isThemeSetting(value)).toBe(true)
    for (const value of ['', 'auto', 'Dark', null, 1]) expect(isThemeSetting(value)).toBe(false)
  })
})
