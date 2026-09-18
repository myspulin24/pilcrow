/**
 * Nanést motiv na dokument.
 *
 * CSS zná jen `light` a `dark`; volbu „podle systému“ rozhoduje tahle vrstva,
 * protože jen ona se umí systému zeptat a poslouchat, kdy si to rozmyslí.
 * Samotné rozhodování je čistá funkce v `@/core/theme`, takže se dá otestovat
 * bez prohlížeče.
 */

import { resolveTheme, type ThemeSetting } from '@/core'

const QUERY = '(prefers-color-scheme: dark)'

function prefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia(QUERY).matches
    : false
}

/**
 * Nastavit motiv a hlídat systém, dokud se volba nezmění.
 *
 * Vrací funkci, která hlídání ukončí. Poslouchá se jen u volby „podle
 * systému“ -- kdo si vybral světlý, nemá důvod zčernat, když si to systém
 * v noci přepne.
 */
export function applyTheme(setting: ThemeSetting): () => void {
  const root = document.documentElement
  const set = () => {
    root.dataset.theme = resolveTheme(setting, prefersDark())
  }
  set()

  if (setting !== 'system' || typeof window === 'undefined' || !window.matchMedia) {
    return () => undefined
  }

  const media = window.matchMedia(QUERY)
  media.addEventListener('change', set)
  return () => media.removeEventListener('change', set)
}
