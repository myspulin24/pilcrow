/**
 * Třináct jazyků, jeden sázeč.
 *
 * Klíčové tvrzení celé té stavby: **tentýž vzorec napsaný v kterémkoli jazyce
 * musí skončit stejně vysázený**. Kdyby to neplatilo, přepínač jazyka by byl
 * past -- uživatel by si vybral zápis, který mu tiše vysází něco jiného.
 */

import { describe, expect, it } from 'vitest'

import {
  CONCEPTS,
  MATH_LANGUAGES,
  mathLanguage,
  mathLanguageByAlias,
  mathLanguageGroups,
  isMathFence,
} from './math-languages'
import { renderMathIn } from './math'

/** Zlomek 3^k/2^n napsaný v každém z jazyků. */
const SAME_FORMULA: Array<[string, string]> = [
  ['latex', String.raw`\frac{3^k}{2^n}`],
  ['amslatex', String.raw`\dfrac{3^k}{2^n}`],
  ['tex', String.raw`{3^k \over 2^n}`],
  ['context', String.raw`\startformula \frac{3^k}{2^n} \stopformula`],
  ['texvc', String.raw`\frac{3^k}{2^n}`],
  ['mathml', '<math><mfrac><msup><mn>3</mn><mi>k</mi></msup><msup><mn>2</mn><mi>n</mi></msup></mfrac></math>'],
  ['mathml-content', '<math><apply><divide/><apply><power/><cn>3</cn><ci>k</ci></apply><apply><power/><cn>2</cn><ci>n</ci></apply></apply></math>'],
  ['omml', '<m:oMath><m:f><m:num><m:r><m:t>3</m:t></m:r></m:num><m:den><m:r><m:t>2</m:t></m:r></m:den></m:f></m:oMath>'],
  ['asciimath', '(3^k)/(2^n)'],
  ['unicodemath', '(3^k)/(2^n)'],
  ['eqn', '3 sup k over 2 sup n'],
  ['typst', 'frac(3^k, 2^n)'],
  ['wolfram', 'Divide[Power[3, k], Power[2, n]]'],
  ['mathjson', '["Divide", ["Power", 3, "k"], ["Power", 2, "n"]]'],
]

describe('rejstřík jazyků', () => {
  it('pokrývá všech třináct zadaných zápisů', () => {
    expect(MATH_LANGUAGES).toHaveLength(14) // 13 + MathML zvlášť prezentační a obsahové
    const labels = MATH_LANGUAGES.map((l) => l.label)
    for (const wanted of [
      'plain TeX', 'LaTeX', 'AMS-LaTeX', 'ConTeXt', 'MathML (Presentation)',
      'MathML (Content)', 'AsciiMath', 'UnicodeMath', 'OMML (Word)', 'Typst',
      'eqn / neqn', 'Wolfram Language', 'MathJSON', 'texvc',
    ]) {
      expect(labels).toContain(wanted)
    }
  })

  it('každý jazyk se najde podle svých názvů a žádný se nepřekrývá', () => {
    const seen = new Set<string>()
    for (const language of MATH_LANGUAGES) {
      expect(language.aliases.length).toBeGreaterThan(0)
      for (const alias of language.aliases) {
        expect(seen.has(alias)).toBe(false)
        seen.add(alias)
        expect(mathLanguageByAlias(alias)?.id).toBe(language.id)
      }
    }
  })

  it('název jazyka pozná bez ohledu na velikost písmen a mezery', () => {
    expect(mathLanguageByAlias('  AsciiMath ')?.id).toBe('asciimath')
    expect(isMathFence('mathjson')).toBe(true)
    expect(isMathFence('ts')).toBe(false)
    expect(isMathFence('')).toBe(false)
  })

  it('u neznámého jazyka spadne zpět na LaTeX, místo aby spadla aplikace', () => {
    expect(mathLanguage('nesmysl' as never).id).toBe('latex')
  })

  it('jazyky jsou rozdělené do skupin pro rozbalovací seznam', () => {
    const groups = mathLanguageGroups()
    expect(groups.map((g) => g.name)).toEqual(['TeX a spol.', 'Značkovací', 'Lineární', 'Výpočetní'])
    expect(groups.flatMap((g) => g.languages)).toHaveLength(MATH_LANGUAGES.length)
  })
})

describe('tentýž vzorec v každém jazyce', () => {
  for (const [id, source] of SAME_FORMULA) {
    it(`${id} vysází zlomek 3^k/2^n`, () => {
      const result = renderMathIn(source, id as never, true)
      expect(result.error).toBeNull()
      expect(result.html).not.toBe('')
      // Buď KaTeX, nebo MathML rovnou do okna -- obojí je platný výsledek.
      expect(result.html.includes('katex') || result.html.includes('<math')).toBe(true)
    })
  }

  it('jazyky vedoucí přes LaTeX se shodnou na struktuře zlomku', () => {
    // Zápisy se liší (`\frac` vs `\over`), ale všechny mají zlomek, trojku
    // v čitateli a dvojku ve jmenovateli.
    for (const id of ['eqn', 'typst', 'wolfram', 'mathjson', 'mathml-content']) {
      const source = SAME_FORMULA.find(([key]) => key === id)![1]
      const { latex } = renderMathIn(source, id as never, true)
      expect(latex).toContain(String.raw`\frac`)
      expect(latex).toMatch(/3\^?\{?k/)
      expect(latex).toMatch(/2\^?\{?n/)
    }
  })
})

describe('ukázky a paleta', () => {
  it('ukázka každého jazyka se opravdu vysází', () => {
    const broken: string[] = []
    for (const language of MATH_LANGUAGES) {
      const result = renderMathIn(language.sample, language.id, true)
      if (result.error || !result.html) broken.push(`${language.label}: ${result.error ?? 'prázdno'}`)
    }
    expect(broken).toEqual([])
  })

  it('každý kousek z palety je v svém jazyce platný', () => {
    // Kdyby nebyl, paleta by nabízela tlačítka, která vysypou chybu.
    const broken: string[] = []
    for (const language of MATH_LANGUAGES) {
      for (const [concept, snippet] of Object.entries(language.snippets)) {
        const filled = snippet.replace(/\$1/g, 'x').replace(/\$2/g, 'y')
        const result = renderMathIn(filled, language.id, false)
        if (result.error) broken.push(`${language.label}/${concept}: ${result.error}`)
      }
    }
    expect(broken).toEqual([])
  })

  it('náhled každého pojmu v paletě je platný LaTeX', () => {
    for (const concept of CONCEPTS) {
      expect(renderMathIn(concept.preview, 'latex', false).error).toBeNull()
    }
  })

  it('jazyky, které mají paletu, pokrývají základní pojmy', () => {
    const essential = ['frac', 'power', 'sqrt']
    for (const language of MATH_LANGUAGES) {
      const keys = Object.keys(language.snippets)
      if (keys.length === 0) continue // MathML Content a OMML se ručně nepíší
      for (const concept of essential) {
        expect(keys).toContain(concept)
      }
    }
  })
})

describe('věrnost se nepředstírá', () => {
  it('u každého jazyka je řečeno, jak věrně se sází', () => {
    for (const language of MATH_LANGUAGES) {
      expect(['exact', 'mapped', 'partial']).toContain(language.fidelity)
      expect(language.hint.length).toBeGreaterThan(10)
    }
  })

  it('ConTeXt se přizná, že jeho prostředí neumí', () => {
    const { warnings } = renderMathIn(String.raw`\startalign a = b \stopalign`, 'context', true)
    expect(warnings.join(' ')).toContain('LuaTeX')
  })

  it('neznámá funkce se vysází jménem a ohlásí, místo aby se vymýšlela', () => {
    const wolfram = renderMathIn('Bessel[x]', 'wolfram', false)
    expect(wolfram.warnings.join(' ')).toContain('Bessel')
    expect(wolfram.latex).toContain(String.raw`\operatorname{Bessel}`)

    const mathjson = renderMathIn('["Nesmysl", 1, 2]', 'mathjson', false)
    expect(mathjson.warnings.join(' ')).toContain('Nesmysl')
  })

  it('rozbitý vstup nespadne, jen se ohlásí', () => {
    for (const [id, bad] of [
      ['mathjson', '{tohle není json'],
      ['mathml', '<math><mfrac>'],
      ['wolfram', 'Sqrt['],
      ['eqn', 'a over'],
      ['typst', 'frac('],
      ['omml', '<m:oMath>'],
    ] as const) {
      expect(() => renderMathIn(bad, id, false)).not.toThrow()
    }
  })
})

describe('bezpečnost', () => {
  it('z MathML se nedá propašovat skript ani odkaz', () => {
    const attacks = [
      '<math><mi>x</mi><script>alert(1)</script></math>',
      '<math><mi onclick="alert(1)">x</mi></math>',
      '<math><maction actiontype="statusline" href="javascript:alert(1)">x</maction></math>',
      '<math><annotation-xml><img src=x onerror="alert(1)"></annotation-xml></math>',
    ]
    for (const attack of attacks) {
      const { html } = renderMathIn(attack, 'mathml', false)
      expect(html).not.toMatch(/<script/i)
      expect(html).not.toMatch(/\son\w+\s*=/i)
      expect(html).not.toMatch(/javascript:/i)
      expect(html).not.toMatch(/<img/i)
    }
  })

  it('z OMML taky ne', () => {
    const { html } = renderMathIn(
      '<m:oMath><m:r><m:t>x</m:t></m:r><script>alert(1)</script></m:oMath>',
      'omml',
      false,
    )
    expect(html).not.toMatch(/<script/i)
  })
})
