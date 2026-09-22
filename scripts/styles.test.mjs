/**
 * Pravidla ve stylech, na kterých závisí chování, ne vzhled.
 *
 * Testy běží v jsdom a ten nic nesází -- šířku panelu ověřit nedokáže. Tohle
 * je proto jiný druh testu: čte `src/styles.css` a hlídá pravidla, jejichž
 * smazáním by se vrátila chyba, kterou nahlásil uživatel. Kdo je odstraní,
 * musí to udělat vědomě -- a smazat i tenhle test.
 *
 * Je v `scripts/`, a ne u komponent, ze stejného důvodu jako `ipc.test.mjs`:
 * čte soubory z disku, což z TypeScriptu bez typů pro Node nejde.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// `process.cwd()`, ne `import.meta.url`: Vitest servíruje moduly přes `/@fs/`,
// takže by z URL vyšla cesta, která na disku neexistuje.
const css = readFileSync(join(process.cwd(), 'src', 'styles.css'), 'utf8')

/** Tělo pravidla pro daný selektor. */
function rule(selector) {
  const start = css.indexOf(`\n${selector} {`)
  expect(start, `pravidlo ${selector} ve stylech chybí`).toBeGreaterThan(-1)
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  return css.slice(open + 1, close)
}

describe('panel asistenta drží šířku', () => {
  /**
   * Bez `min-width: 0` se panel roztáhl podle nejširšího řádku v odpovědi.
   *
   * Prvek ve flexu se sám od sebe nesmrskne pod šířku svého obsahu, a blok
   * kódu od Clauda bývá širší než panel: naměřeno 1262 bodů místo 333.
   * `flex-basis` říká, jak široký panel má být; tohle teprve zařídí, že to
   * platí.
   */
  it('má min-width: 0, jinak ho blok kódu v odpovědi roztáhne', () => {
    expect(rule('.assistant')).toMatch(/min-width:\s*0/)
  })

  it('řádek s kontextem se zalomí, místo aby přetekl ven', () => {
    expect(rule('.assistant__context')).toMatch(/overflow-wrap:\s*anywhere/)
  })

  it('blok kódu v odpovědi má vlastní vodorovný posuvník', () => {
    expect(rule('.markdown-body pre')).toMatch(/overflow-x:\s*auto/)
  })
})
