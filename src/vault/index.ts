/**
 * Picking a vault implementation.
 *
 * The desktop app always gets `TauriVault`. A browser gets `MemoryVault` with
 * a banner explaining that nothing is being written to disk -- which is the
 * "graceful handling of unavailable APIs" rule applied at the top level rather
 * than sprinkled through every call site.
 */

import { t } from '@/core'
import { MemoryVault } from './memory-vault'
import { SEED_NOTES } from './seed'
import { isTauriAvailable, TauriVault } from './tauri-vault'
import type { VaultApi } from './api'

export * from './api'
export { MemoryVault } from './memory-vault'
export { TauriVault, isTauriAvailable } from './tauri-vault'
export { toIndexRecord, toIndexRecords } from './record'
export { SEED_NOTES } from './seed'

export function createVault(): VaultApi {
  if (isTauriAvailable()) return new TauriVault()
  return new MemoryVault({
    seed: SEED_NOTES,
    // Předstíraná složka, aby měl průzkumník v náhledu v prohlížeči co ukázat.
    // Desktopová aplikace místo toho čte skutečný souborový systém.
    externalFiles: {
      '/ukazka/README.md': '# Ukázková složka\n\nZastupuje složku na disku.\n',
      '/ukazka/navody/instalace.md': '# Instalace\n\nSpusť `npm start`.\n',
      '/ukazka/navody/pokrocile/ladeni.md': '# Ladění\n\nHlouběji ve stromu.\n',
      '/ukazka/reference/api.md': '# API\n\nReferenční materiál.\n',
      '/druha-slozka/README.md': '# Druhá složka\n\nAby šlo vyzkoušet víc otevřených složek naráz.\n',
      '/druha-slozka/poznamky/schuzka.md': '# Schůzka\n\nZápis.\n',
    },
    externalRoot: '/ukazka',
    // Druhé „Otevřít složku...“ v náhledu vybere jinou složku, takže je vidět
    // i to, jak se sloupec chová s víc otevřenými naráz.
    externalRoots: ['/ukazka', '/druha-slozka'],
    label: t.browser.demoVault,
    warning: t.browser.warning,
  })
}
