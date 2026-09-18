/**
 * Zkopírovat blok kódu, na jehož tlačítko se kliklo.
 *
 * Náhled i panel Clauda vkládají hotové HTML, takže na tlačítkách uvnitř
 * nejde mít obsluhu z Reactu -- klik se odchytává až na obalu. Tohle je ta
 * společná část, aby se v obou místech chovala stejně.
 *
 * Vrací `true`, když šlo o tlačítko kopírování; volající pak ví, že klik už
 * je vyřízený a nemá ho zkoušet vyložit jinak.
 */

import { t } from '@/core'

/** Jak dlouho zůstane na tlačítku fajfka. */
const FEEDBACK_MS = 1500

export function handleCopyCodeClick(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  const button = target.closest('[data-copy-code]')
  if (!(button instanceof HTMLElement)) return false

  // Text se bere z `<code>`, ne z celého bloku: popisek jazyka ani samo
  // tlačítko do schránky nepatří.
  const code = button.closest('.code-block')?.querySelector('code')
  const text = code?.textContent ?? ''
  if (!text) return true

  void navigator.clipboard?.writeText(text).then(
    () => {
      button.classList.add('is-copied')
      button.setAttribute('aria-label', t.markdown.codeCopied)
      button.setAttribute('title', t.markdown.codeCopied)
      setTimeout(() => {
        // Blok se mezitím mohl překreslit; sahat na odpojený prvek nevadí,
        // ale nemá smysl to hlídat jinak než takhle.
        button.classList.remove('is-copied')
        button.setAttribute('aria-label', t.markdown.copyCode)
        button.setAttribute('title', t.markdown.copyCode)
      }, FEEDBACK_MS)
    },
    () => {
      // Schránka může být odepřená. Mlčet by vypadalo jako že se to povedlo.
      button.setAttribute('aria-label', t.markdown.copyFailed)
      button.setAttribute('title', t.markdown.copyFailed)
    },
  )
  return true
}
