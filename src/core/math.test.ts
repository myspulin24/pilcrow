import { describe, expect, it } from 'vitest'

import { applySnippet, MATH_GROUPS, renderMath, validateMath } from './math'

describe('renderMath', () => {
  it('vysází vzorec z obrázku, diakritiku v indexu a všechno', () => {
    const tex = String.raw`c_{right} = \frac{3^k}{2^n}\left(c_{min} + B_{přímý}\right)`
    const { html, error } = renderMath(tex, true)

    expect(error).toBeNull()
    // Skutečný zlomek, ne lomítko.
    expect(html).toContain('frac-line')
    // České písmeno v indexu prošlo až do výstupu.
    expect(html).toContain('ř')
    // Blokový režim se pozná podle obalu.
    expect(html).toContain('katex-display')
  })

  it('vzorec v řádku nesází jako blok', () => {
    const { html } = renderMath('E = mc^2', false)
    expect(html).toContain('katex')
    expect(html).not.toContain('katex-display')
  })

  it('prázdný vstup nevrací nic a není to chyba', () => {
    expect(renderMath('   ', true)).toEqual({ html: '', error: null })
  })

  it('u rozbitého vzorce vrátí HTML i českou chybu', () => {
    const { html, error } = renderMath(String.raw`\frac{1}{`, false)
    // Něco se vykreslí, aby bylo vidět, kde se to zaseklo.
    expect(html).not.toBe('')
    expect(error).toBe('Vzorec není dopsaný — chybí uzavírací závorka.')
  })

  it('neznámý příkaz pojmenuje', () => {
    expect(validateMath(String.raw`\neexistuje{x}`)).toBe('Neznámý příkaz \\neexistuje.')
  })

  it('dvojitý index poradí, jak opravit', () => {
    expect(validateMath('x^2^3')).toBe(
      'Dvakrát za sebou horní nebo dolní index. Dej ten druhý do složených závorek.',
    )
  })

  it('správný vzorec chybu nehlásí', () => {
    expect(validateMath(String.raw`\sum_{i=1}^{n} i^2`)).toBeNull()
  })

  it('z vzorce nevyrobí odkaz ani nic spustitelného', () => {
    // Výstup jde rovnou do `dangerouslySetInnerHTML`, takže tohle je hranice,
    // o kterou jde. `trust: false` nechá `\href` vysázet jako pouhý text:
    // adresa je vidět, ale žádný <a> ani href z ní nevznikne.
    for (const tex of [
      String.raw`\href{javascript:alert(1)}{klikni}`,
      String.raw`\url{javascript:alert(1)}`,
      String.raw`\includegraphics{x.png}`,
    ]) {
      const { html } = renderMath(tex, false)
      expect(html).not.toMatch(/<a\b/i)
      expect(html).not.toMatch(/href\s*=/i)
      expect(html).not.toMatch(/<script|on\w+\s*=/i)
    }
  })
})

describe('paleta značek', () => {
  it('každá značka v paletě je platný vzorec', () => {
    // Kdyby to neplatilo, paleta by nabízela tlačítka, která vysypou chybu.
    const broken: string[] = []
    for (const group of MATH_GROUPS) {
      for (const snippet of group.snippets) {
        if (validateMath(snippet.preview)) broken.push(`${group.name}/${snippet.label}`)
        // Vložený tvar bez zástupných míst musí projít taky.
        const inserted = snippet.insert.replace(/\$1/g, 'x').replace(/\$2/g, 'y')
        if (validateMath(inserted)) broken.push(`${group.name}/${snippet.label} (vloženo)`)
      }
    }
    expect(broken).toEqual([])
  })

  it('žádné dvě značky nemají stejný popisek ve stejné skupině', () => {
    for (const group of MATH_GROUPS) {
      const labels = group.snippets.map((s) => s.label)
      expect(new Set(labels).size).toBe(labels.length)
    }
  })
})

describe('applySnippet', () => {
  it('bez výběru vloží značku a postaví kurzor na první místo', () => {
    const result = applySnippet('', 0, 0, String.raw`\frac{$1}{$2}`)
    expect(result.tex).toBe(String.raw`\frac{}{}`)
    // Kurzor mezi první dvojicí závorek.
    expect(result.tex.slice(0, result.selectionStart)).toBe(String.raw`\frac{`)
  })

  it('vybraný text dosadí dovnitř a skočí na druhé místo', () => {
    const result = applySnippet('a + b', 0, 5, String.raw`\frac{$1}{$2}`)
    expect(result.tex).toBe(String.raw`\frac{a + b}{}`)
    // Druhá dvojice závorek: pozice se počítá až po dosazení výběru.
    expect(result.tex.slice(0, result.selectionStart)).toBe(String.raw`\frac{a + b}{`)
  })

  it('u značky bez druhého místa nechá kurzor za ní', () => {
    const result = applySnippet('x', 0, 1, String.raw`\sqrt{$1}`)
    expect(result.tex).toBe(String.raw`\sqrt{x}`)
    expect(result.selectionStart).toBe(result.tex.length)
  })

  it('vloží doprostřed existujícího vzorce', () => {
    const result = applySnippet('a +  + b', 4, 4, String.raw`\pi `)
    expect(result.tex).toBe('a + \\pi  + b')
  })

  it('značka bez zástupných míst se jen vloží', () => {
    const result = applySnippet('', 0, 0, String.raw`\infty `)
    expect(result.tex).toBe('\\infty ')
    expect(result.selectionStart).toBe(result.tex.length)
  })

  it('pozice mimo text nevadí', () => {
    expect(() => applySnippet('ab', 99, 150, String.raw`\pi `)).not.toThrow()
    expect(applySnippet('ab', -3, 1, 'X').tex).toBe('Xb')
  })
})
