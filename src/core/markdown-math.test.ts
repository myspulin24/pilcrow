/**
 * Kde se vzorce potkávají se zbytkem Markdownu.
 *
 * Samotné sázení je otázka KaTeXu a řeší ho `math.test.ts`. Tady jde o to, co
 * je na vzorcích v Markdownu opravdu ošidné: `$` je běžný znak a `_`, `\`, `{`
 * a `*` mají v Markdownu vlastní význam. Dokud se vzorec neodloží stranou dřív
 * než proběhnou ostatní průchody, `c_{min} + c_{max}` se změní v kurzívu
 * a LaTeX je nenávratně rozbitý.
 */

import { describe, expect, it } from 'vitest'

import { buildExcerpt } from './note'
import { renderMarkdown } from './markdown'

describe('vzorec jako samostatný blok', () => {
  it('vysází $$ blok přes víc řádků', () => {
    const html = renderMarkdown('$$\nc_{right} = \\frac{3^k}{2^n}\n$$')
    expect(html).toContain('math--block')
    expect(html).toContain('katex-display')
    // Zdroj zůstává na prvku, aby ho editor uměl znovu otevřít.
    expect(html).toContain('data-tex="c_{right} = \\frac{3^k}{2^n}"')
  })

  it('vysází $$ ... $$ na jednom řádku', () => {
    expect(renderMarkdown('$$E = mc^2$$')).toContain('katex-display')
  })

  it('vysází celý vzorec ze zadání, i s diakritikou v indexu', () => {
    const html = renderMarkdown(
      '$$\nc_{right} = \\frac{3^k}{2^n}\\left(c_{min} + B_{přímý}\\right)\n$$',
    )
    expect(html).toContain('frac-line')
    expect(html).toContain('ř')
    expect(html).not.toContain('math--error')
  })
})

describe('vzorec v řádku', () => {
  it('pozná $ ... $ uprostřed věty', () => {
    const html = renderMarkdown('Platí $E = mc^2$ a nic víc.')
    expect(html).toContain('math--inline')
    expect(html).not.toContain('katex-display')
  })

  it('podtržítka ve vzorci neudělá kurzívou', () => {
    const html = renderMarkdown('$c_{min} + c_{max}$')
    expect(html).not.toContain('<em>')
    expect(html).toContain('math--inline')
  })
})

describe('co vzorec není', () => {
  it('ceny nechá být', () => {
    const html = renderMarkdown('Stálo to 5$ a pak dalších 10$ navíc.')
    expect(html).not.toContain('katex')
    expect(html).toContain('5$')
  })

  it('respektuje escapovaný dolar', () => {
    expect(renderMarkdown('Cena je \\$5 a \\$9.')).not.toContain('katex')
  })

  it('v kódu na řádku nesází nic', () => {
    const html = renderMarkdown('Napiš `$x$` a nic se nestane.')
    expect(html).not.toContain('katex')
    expect(html).toContain('<code>$x$</code>')
  })

  it('v bloku kódu taky ne', () => {
    expect(renderMarkdown('```\n$$x$$\n```')).not.toContain('katex')
  })
})

describe('chyby a bezpečnost', () => {
  it('rozbitý vzorec označí a vysvětlí česky', () => {
    const html = renderMarkdown('$$\n\\frac{1}{\n$$')
    expect(html).toContain('math--error')
    expect(html).toContain('title="Vzorec není dopsaný')
  })

  it('zdroj v atributu escapuje', () => {
    const html = renderMarkdown('$x < "y"$')
    expect(html).not.toContain('data-tex="x < "y""')
    expect(html).toContain('&quot;')
  })

  it('ze vzorce nevznikne odkaz ani skript', () => {
    const html = renderMarkdown('$$\\href{javascript:alert(1)}{klik}$$')
    expect(html).not.toMatch(/<a\b/i)
    expect(html).not.toMatch(/href\s*=/i)
    expect(html).not.toMatch(/<script|on\w+\s*=/i)
  })

  it('nespadne na nedopsaných dolarech', () => {
    for (const input of ['$'.repeat(300), '$$'.repeat(100), '$$\\frac{1}{', '$$\n'.repeat(50)]) {
      expect(() => renderMarkdown(input)).not.toThrow()
    }
  })
})

describe('úryvek v seznamu poznámek', () => {
  it('ze samostatného vzorce nechá jen značku', () => {
    const excerpt = buildExcerpt(`Úvod.\n\n$$\n${String.raw`c_{right} = \frac{3^k}{2^n}`}\n$$\n\nZávěr.`)
    expect(excerpt).toBe('Úvod. ⟨vzorec⟩ Závěr.')
  })

  it('vzorec v řádku nechá čitelný a nepoplete si ho s kurzívou', () => {
    // Bez zvláštního zacházení by `c_{min}` skončilo jako `c{min}`.
    expect(buildExcerpt(String.raw`Platí $c_{min} \leq c$ vždy.`)).toBe(
      String.raw`Platí c_{min} \leq c vždy.`,
    )
  })

  it('ceny nechá být', () => {
    expect(buildExcerpt('Stálo to 5$ a 10$ navíc.')).toBe('Stálo to 5$ a 10$ navíc.')
  })
})
