/**
 * Jazyky z rodiny TeXu.
 *
 * LaTeX a AMS-LaTeX jde do KaTeXu rovnou -- balíčky `amsmath` a `amssymb` jsou
 * v něm zabudované, takže `\begin{align}`, `\mathbb` i `\lvert` fungují bez
 * překladu. Zbylé tři potřebují jen málo, a to málo je tady.
 */

import { ok, type MathConversion } from './types'

/** LaTeX a AMS-LaTeX: nic se nepřekládá, KaTeX jim rozumí přímo. */
export function fromLatex(source: string): MathConversion {
  return ok(source.trim())
}

/**
 * Plain TeX.
 *
 * Liší se hlavně infixovými konstrukcemi, které LaTeX nahradil příkazy:
 * `a \over b` místo `\frac{a}{b}`. KaTeX `\over` umí, ale `\choose` a spol.
 * ne vždy v podobě, kterou plain TeX čekal, takže se přeloží.
 *
 * `$$ ... $$` kolem vzorce je v plain TeXu způsob, jak říct „na samostatný
 * řádek"; tady o tom rozhoduje přepínač v okně, takže se ty dolary odstraní.
 */
export function fromPlainTex(source: string): MathConversion {
  let text = source.trim()
  const warnings: string[] = []

  text = text.replace(/^\$\$([\s\S]*)\$\$$/, '$1').trim()
  text = text.replace(/^\$([\s\S]*)\$$/, '$1').trim()

  // `{a \choose b}` -> `\binom{a}{b}`; totéž pro brack a brace.
  const INFIX: Array<[RegExp, (a: string, b: string) => string]> = [
    [/\{([^{}]*)\\choose([^{}]*)\}/g, (a, b) => `\\binom{${a.trim()}}{${b.trim()}}`],
    [/\{([^{}]*)\\brack([^{}]*)\}/g, (a, b) => `\\genfrac{[}{]}{0pt}{}{${a.trim()}}{${b.trim()}}`],
    [/\{([^{}]*)\\brace([^{}]*)\}/g, (a, b) => `\\genfrac\\{\\}{0pt}{}{${a.trim()}}{${b.trim()}}`],
  ]
  for (const [pattern, build] of INFIX) {
    text = text.replace(pattern, (_full, a: string, b: string) => build(a, b))
  }

  // `\eqno` je číslování rovnice, které tu nemá kam patřit.
  if (/\\eqno/.test(text)) {
    warnings.push('\\eqno (číslo rovnice) se nevysází.')
    text = text.replace(/\\eqno\s*\S+/g, '')
  }

  return ok(text.trim(), warnings)
}

/**
 * texvc -- omezený TeX z MediaWiki.
 *
 * Je to podmnožina LaTeXu plus hrstka příkazů, které si Wikipedia přidala
 * a které v LaTeXu nikdy nebyly. Ty se přeloží, zbytek projde beze změny.
 */
const TEXVC_ALIASES: Array<[RegExp, string]> = [
  [/\\R\b/g, String.raw`\mathbb{R}`],
  [/\\Reals\b/g, String.raw`\mathbb{R}`],
  [/\\reals\b/g, String.raw`\mathbb{R}`],
  [/\\Z\b/g, String.raw`\mathbb{Z}`],
  [/\\N\b/g, String.raw`\mathbb{N}`],
  [/\\Q\b/g, String.raw`\mathbb{Q}`],
  [/\\C\b/g, String.raw`\mathbb{C}`],
  [/\\H\b/g, String.raw`\mathbb{H}`],
  [/\\sub\b/g, String.raw`\subset`],
  [/\\supe\b/g, String.raw`\supseteq`],
  [/\\sube\b/g, String.raw`\subseteq`],
  [/\\infin\b/g, String.raw`\infty`],
  [/\\lcm\b/g, String.raw`\operatorname{lcm}`],
  [/\\sgn\b/g, String.raw`\operatorname{sgn}`],
  [/\\arccot\b/g, String.raw`\operatorname{arccot}`],
  [/\\arcsec\b/g, String.raw`\operatorname{arcsec}`],
  [/\\arccsc\b/g, String.raw`\operatorname{arccsc}`],
  [/\\sech\b/g, String.raw`\operatorname{sech}`],
  [/\\csch\b/g, String.raw`\operatorname{csch}`],
  [/\\empty\b/g, String.raw`\emptyset`],
  [/\\vline\b/g, String.raw`\vert`],
  [/\\part\b/g, String.raw`\partial`],
]

export function fromTexvc(source: string): MathConversion {
  let text = source.trim()
  for (const [pattern, replacement] of TEXVC_ALIASES) {
    text = text.replace(pattern, replacement)
  }
  return ok(text)
}

/**
 * ConTeXt.
 *
 * Tohle je ze všech jazyků ten nejméně poctivý převod a je fér to říct rovnou:
 * ConTeXt je plnohodnotný sázecí systém nad LuaTeX a vysázet ho věrně znamená
 * mít LuaTeX nainstalovaný. To se do aplikace zabalit nedá.
 *
 * Co se udělat dá: matematika v ConTeXtu je z velké části TeX, takže se sundají
 * jeho obaly (`\startformula ... \stopformula`) a přeloží se příkazy, které má
 * jinak než LaTeX. Na běžný vzorec to stačí; na vlastní makra ne, a v tom
 * případě se ozve varování.
 */
const CONTEXT_COMMANDS: Array<[RegExp, string]> = [
  [/\\startformula\b/g, ''],
  [/\\stopformula\b/g, ''],
  [/\\startmathmatrix\b/g, String.raw`\begin{matrix}`],
  [/\\stopmathmatrix\b/g, String.raw`\end{matrix}`],
  [/\\NC\b/g, '&'],
  [/\\NR\b/g, String.raw`\\`],
  [/\\im\b/g, String.raw`\mathrm{i}`],
  [/\\dd\b/g, String.raw`\mathrm{d}`],
  [/\\ee\b/g, String.raw`\mathrm{e}`],
  [/\\npi\b/g, String.raw`\uppi`],
  [/\\digits\b/g, ''],
]

export function fromContext(source: string): MathConversion {
  let text = source.trim()
  const warnings: string[] = []

  for (const [pattern, replacement] of CONTEXT_COMMANDS) {
    text = text.replace(pattern, replacement)
  }

  // `\start...`/`\stop...`, na které jsme nesáhli, KaTeX neumí a tiše by je
  // vysypal jako chybu bez vysvětlení.
  const leftover = text.match(/\\(start|stop)[a-zA-Z]+/g)
  if (leftover) {
    warnings.push(
      `Prostředí ${[...new Set(leftover)].join(', ')} umí jen ConTeXt s LuaTeXem, tady se vynechá.`,
    )
    text = text.replace(/\\(start|stop)[a-zA-Z]+/g, '')
  }

  return ok(text.trim(), warnings)
}
