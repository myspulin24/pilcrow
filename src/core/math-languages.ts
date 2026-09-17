/**
 * Rejstřík matematických jazyků.
 *
 * Jedno místo, kde je o každém jazyce všechno: jak se jmenuje, jak se pozná
 * v souboru, jak věrně ho umíme vysázet a jak se v něm píší běžné konstrukce.
 *
 * Paleta v okně vzorců je postavená na pojmech, ne na zápisech: „odmocnina" je
 * jeden pojem a každý jazyk k němu dodá svůj tvar. Bez toho by přepínač jazyka
 * byl jen ozdoba -- naklikat vzorec musí jít v každém z nich.
 */

import { fromAsciiMath, fromMathml, fromOmml, fromUnicodeMath } from './math-convert/markup'
import { fromContext, fromLatex, fromPlainTex, fromTexvc } from './math-convert/tex-family'
import { fromEqn } from './math-convert/eqn'
import { fromMathJson } from './math-convert/mathjson'
import { fromTypst } from './math-convert/typst'
import { fromWolfram } from './math-convert/wolfram'
import type { MathConversion } from './math-convert/types'

export type { MathConversion } from './math-convert/types'

export type MathLanguageId =
  | 'latex'
  | 'amslatex'
  | 'tex'
  | 'context'
  | 'texvc'
  | 'mathml'
  | 'mathml-content'
  | 'omml'
  | 'asciimath'
  | 'unicodemath'
  | 'eqn'
  | 'typst'
  | 'wolfram'
  | 'mathjson'

/**
 * Jak věrně jazyk vysázíme.
 *
 * `exact`  -- sází to engine, kterému ta syntax patří.
 * `mapped` -- převod má definované mapování a knihovnu za sebou.
 * `partial`-- vlastní překladač běžné podmnožiny; co nezná, ohlásí.
 */
export type MathFidelity = 'exact' | 'mapped' | 'partial'

/** Pojmy, které paleta nabízí. Jazyk dodá tvar, ne význam. */
export type ConceptId =
  | 'frac'
  | 'power'
  | 'sub'
  | 'sqrt'
  | 'nthroot'
  | 'sum'
  | 'prod'
  | 'int'
  | 'lim'
  | 'paren'
  | 'abs'
  | 'matrix'
  | 'infinity'
  | 'pi'
  | 'alpha'
  | 'times'
  | 'leq'
  | 'neq'
  | 'in'
  | 'text'

export interface Concept {
  id: ConceptId
  label: string
  title: string
  /** Náhled na tlačítku, vždy v LaTeXu -- vysází ho KaTeX. */
  preview: string
}

/** Pořadí v paletě: od toho, co se píše nejčastěji. */
export const CONCEPTS: Concept[] = [
  { id: 'frac', label: 'a/b', title: 'Zlomek', preview: String.raw`\frac{a}{b}` },
  { id: 'power', label: 'x²', title: 'Mocnina', preview: 'x^{2}' },
  { id: 'sub', label: 'xₙ', title: 'Dolní index', preview: 'x_{n}' },
  { id: 'sqrt', label: '√', title: 'Odmocnina', preview: String.raw`\sqrt{x}` },
  { id: 'nthroot', label: 'ⁿ√', title: 'N-tá odmocnina', preview: String.raw`\sqrt[n]{x}` },
  { id: 'sum', label: '∑', title: 'Suma', preview: String.raw`\sum_{i=1}^{n}` },
  { id: 'prod', label: '∏', title: 'Součin', preview: String.raw`\prod_{i=1}^{n}` },
  { id: 'int', label: '∫', title: 'Integrál', preview: String.raw`\int_{a}^{b}` },
  { id: 'lim', label: 'lim', title: 'Limita', preview: String.raw`\lim_{x \to 0}` },
  { id: 'paren', label: '( )', title: 'Závorky', preview: String.raw`\left(\frac{a}{b}\right)` },
  { id: 'abs', label: '| |', title: 'Absolutní hodnota', preview: String.raw`\left|x\right|` },
  { id: 'matrix', label: 'Matice', title: 'Matice', preview: String.raw`\begin{pmatrix}a & b\\c & d\end{pmatrix}` },
  { id: 'infinity', label: '∞', title: 'Nekonečno', preview: String.raw`\infty` },
  { id: 'pi', label: 'π', title: 'Pí', preview: String.raw`\pi` },
  { id: 'alpha', label: 'α', title: 'Alfa', preview: String.raw`\alpha` },
  { id: 'times', label: '×', title: 'Krát', preview: String.raw`\times` },
  { id: 'leq', label: '≤', title: 'Menší nebo rovno', preview: String.raw`\leq` },
  { id: 'neq', label: '≠', title: 'Nerovná se', preview: String.raw`\neq` },
  { id: 'in', label: '∈', title: 'Je prvkem', preview: String.raw`\in` },
  { id: 'text', label: 'Text', title: 'Obyčejný text ve vzorci', preview: String.raw`\text{slovo}` },
]

/** `$1` je místo pro kurzor nebo označený text, `$2` druhé místo. */
type Snippets = Partial<Record<ConceptId, string>>

const TEX_SNIPPETS: Snippets = {
  frac: String.raw`\frac{$1}{$2}`,
  power: '$1^{$2}',
  sub: '$1_{$2}',
  sqrt: String.raw`\sqrt{$1}`,
  nthroot: String.raw`\sqrt[$1]{$2}`,
  sum: String.raw`\sum_{$1}^{$2}`,
  prod: String.raw`\prod_{$1}^{$2}`,
  int: String.raw`\int_{$1}^{$2}`,
  lim: String.raw`\lim_{$1}`,
  paren: String.raw`\left( $1 \right)`,
  abs: String.raw`\left| $1 \right|`,
  matrix: String.raw`\begin{pmatrix} $1 & $2 \\ c & d \end{pmatrix}`,
  infinity: String.raw`\infty `,
  pi: String.raw`\pi `,
  alpha: String.raw`\alpha `,
  times: String.raw`\times `,
  leq: String.raw`\leq `,
  neq: String.raw`\neq `,
  in: String.raw`\in `,
  text: String.raw`\text{$1}`,
}

const ASCIIMATH_SNIPPETS: Snippets = {
  frac: '($1)/($2)',
  power: '$1^($2)',
  sub: '$1_($2)',
  sqrt: 'sqrt($1)',
  nthroot: 'root($1)($2)',
  sum: 'sum_($1)^($2)',
  prod: 'prod_($1)^($2)',
  int: 'int_($1)^($2)',
  lim: 'lim_($1)',
  paren: '($1)',
  abs: 'abs($1)',
  matrix: '[[$1,$2],[c,d]]',
  infinity: 'oo ',
  pi: 'pi ',
  alpha: 'alpha ',
  times: 'xx ',
  leq: '<= ',
  neq: '!= ',
  in: 'in ',
  text: 'text($1)',
}

const UNICODEMATH_SNIPPETS: Snippets = {
  frac: '($1)/($2)',
  power: '$1^($2)',
  sub: '$1_($2)',
  sqrt: '√($1)',
  nthroot: '√($1&$2)',
  sum: '∑_($1)^($2)',
  prod: '∏_($1)^($2)',
  int: '∫_($1)^($2)',
  lim: 'lim_($1)',
  paren: '($1)',
  abs: '|$1|',
  matrix: '■($1&$2@c&d)',
  infinity: '∞',
  pi: 'π',
  alpha: 'α',
  times: '×',
  leq: '≤',
  neq: '≠',
  in: '∈',
  text: '"$1"',
}

const EQN_SNIPPETS: Snippets = {
  frac: '{$1} over {$2}',
  power: '$1 sup {$2}',
  sub: '$1 sub {$2}',
  sqrt: 'sqrt {$1}',
  sum: 'sum from {$1} to {$2}',
  prod: 'prod from {$1} to {$2}',
  int: 'int from {$1} to {$2}',
  lim: 'lim from {$1}',
  paren: 'left ( $1 right )',
  abs: 'left | $1 right |',
  infinity: 'inf ',
  pi: 'pi ',
  alpha: 'alpha ',
  times: 'times ',
  leq: '<= ',
  neq: '!= ',
  text: '"$1"',
}

const TYPST_SNIPPETS: Snippets = {
  frac: 'frac($1, $2)',
  power: '$1^($2)',
  sub: '$1_($2)',
  sqrt: 'sqrt($1)',
  nthroot: 'root($1, $2)',
  sum: 'sum_($1)^($2)',
  prod: 'product_($1)^($2)',
  int: 'integral_($1)^($2)',
  lim: 'lim_($1)',
  paren: '($1)',
  abs: 'abs($1)',
  matrix: 'mat($1, $2; c, d)',
  infinity: 'infinity ',
  pi: 'pi ',
  alpha: 'alpha ',
  times: 'times ',
  leq: '<= ',
  neq: '!= ',
  in: 'in ',
  text: '"$1"',
}

const WOLFRAM_SNIPPETS: Snippets = {
  frac: '($1)/($2)',
  power: '$1^($2)',
  sqrt: 'Sqrt[$1]',
  nthroot: '$2^(1/$1)',
  sum: 'Sum[$1, {i, 1, $2}]',
  prod: 'Product[$1, {i, 1, $2}]',
  int: 'Integrate[$1, {x, 0, $2}]',
  lim: 'Limit[$1, x -> 0]',
  paren: '($1)',
  abs: 'Abs[$1]',
  matrix: '{{$1, $2}, {c, d}}',
  infinity: 'Infinity',
  pi: 'Pi',
  alpha: 'Alpha',
  times: '*',
  leq: ' <= ',
  neq: ' != ',
  text: '"$1"',
}

const MATHML_SNIPPETS: Snippets = {
  frac: '<mfrac><mi>$1</mi><mi>$2</mi></mfrac>',
  power: '<msup><mi>$1</mi><mn>$2</mn></msup>',
  sub: '<msub><mi>$1</mi><mn>$2</mn></msub>',
  sqrt: '<msqrt><mi>$1</mi></msqrt>',
  nthroot: '<mroot><mi>$2</mi><mn>$1</mn></mroot>',
  paren: '<mo>(</mo>$1<mo>)</mo>',
  infinity: '<mi>&#x221E;</mi>',
  pi: '<mi>&#x3C0;</mi>',
  alpha: '<mi>&#x3B1;</mi>',
  times: '<mo>&#xD7;</mo>',
  leq: '<mo>&#x2264;</mo>',
  neq: '<mo>&#x2260;</mo>',
  in: '<mo>&#x2208;</mo>',
  text: '<mtext>$1</mtext>',
}

/**
 * MathJSON má zástupná místa v uvozovkách schválně.
 *
 * Symbol je v MathJSON řetězec, takže `["Divide", x, y]` není platný JSON
 * a paleta by vyráběla zápis, který se ani nepřečte. S uvozovkami vyjde
 * `["Divide", "x", "y"]` a prázdný výběr dá `""`, což projde taky.
 */
const MATHJSON_SNIPPETS: Snippets = {
  frac: '["Divide", "$1", "$2"]',
  power: '["Power", "$1", "$2"]',
  sub: '["Subscript", "$1", "$2"]',
  sqrt: '["Sqrt", "$1"]',
  nthroot: '["Root", "$2", "$1"]',
  sum: '["Sum", "$1", ["Triple", "i", 1, "$2"]]',
  prod: '["Product", "$1", ["Triple", "i", 1, "$2"]]',
  int: '["Integrate", "$1", ["Triple", "x", 0, "$2"]]',
  paren: '["Delimiter", "$1"]',
  abs: '["Abs", "$1"]',
  matrix: '["List", ["List", "$1", "$2"], ["List", "c", "d"]]',
  infinity: '"PositiveInfinity"',
  pi: '"Pi"',
  alpha: '"Alpha"',
  times: '["Multiply", "$1", "$2"]',
  leq: '["LessEqual", "$1", "$2"]',
  neq: '["NotEqual", "$1", "$2"]',
  in: '["Element", "$1", "$2"]',
  text: '{"str": "$1"}',
}

export interface MathLanguage {
  id: MathLanguageId
  label: string
  /** Skupina v rozbalovacím seznamu. */
  group: string
  hint: string
  fidelity: MathFidelity
  /**
   * Jak se jazyk píše za `` ``` `` v souboru. První je ten, který se zapisuje;
   * ostatní se při čtení uznají taky.
   */
  aliases: string[]
  /** Ukázka, která se nabídne v prázdném okně. */
  sample: string
  snippets: Snippets
  convert: (source: string, display: boolean) => MathConversion
}

export const MATH_LANGUAGES: MathLanguage[] = [
  {
    id: 'latex',
    label: 'LaTeX',
    group: 'TeX a spol.',
    hint: 'Nejrozšířenější zápis. Tohle je i to, co se skrývá za $ ... $.',
    fidelity: 'exact',
    aliases: ['latex', 'math', 'tex-latex'],
    sample: String.raw`c_{right} = \frac{3^k}{2^n}`,
    snippets: TEX_SNIPPETS,
    convert: (source) => fromLatex(source),
  },
  {
    id: 'amslatex',
    label: 'AMS-LaTeX',
    group: 'TeX a spol.',
    hint: 'LaTeX s balíčky amsmath a amssymb — zarovnané soustavy, \\mathbb, \\lvert.',
    fidelity: 'exact',
    aliases: ['amslatex', 'amsmath', 'ams'],
    sample: String.raw`\begin{aligned} a &= b + c \\ d &= e \end{aligned}`,
    snippets: TEX_SNIPPETS,
    convert: (source) => fromLatex(source),
  },
  {
    id: 'tex',
    label: 'plain TeX',
    group: 'TeX a spol.',
    hint: 'Původní TeX: a \\over b místo \\frac, {n \\choose k} místo \\binom.',
    fidelity: 'exact',
    aliases: ['tex', 'plaintex', 'plain-tex'],
    sample: String.raw`{3^k \over 2^n}`,
    snippets: TEX_SNIPPETS,
    convert: (source) => fromPlainTex(source),
  },
  {
    id: 'context',
    label: 'ConTeXt',
    group: 'TeX a spol.',
    hint: 'Sundají se obaly \\startformula a přeloží se příkazy, které má jinak než LaTeX.',
    fidelity: 'partial',
    aliases: ['context'],
    sample: String.raw`\startformula \frac{3^k}{2^n} \stopformula`,
    snippets: TEX_SNIPPETS,
    convert: (source) => fromContext(source),
  },
  {
    id: 'texvc',
    label: 'texvc',
    group: 'TeX a spol.',
    hint: 'Omezený TeX z Wikipedie. Navíc umí \\R, \\Z, \\sub a spol.',
    fidelity: 'exact',
    aliases: ['texvc', 'wikitex'],
    sample: String.raw`x \in \R \sub \C`,
    snippets: TEX_SNIPPETS,
    convert: (source) => fromTexvc(source),
  },
  {
    id: 'mathml',
    label: 'MathML (Presentation)',
    group: 'Značkovací',
    hint: 'Vykresluje ho samo okno aplikace, bez překladu. Nejvěrnější cesta vůbec.',
    fidelity: 'exact',
    aliases: ['mathml', 'mathml-presentation'],
    sample: '<math><mfrac><msup><mn>3</mn><mi>k</mi></msup><msup><mn>2</mn><mi>n</mi></msup></mfrac></math>',
    snippets: MATHML_SNIPPETS,
    convert: (source, display) => fromMathml(source, display),
  },
  {
    id: 'mathml-content',
    label: 'MathML (Content)',
    group: 'Značkovací',
    hint: 'Popisuje význam, ne vzhled. Převede se do LaTeXu, zápis nemusí sedět na chlup.',
    fidelity: 'partial',
    aliases: ['mathml-content', 'content-mathml'],
    sample: '<math><apply><divide/><ci>a</ci><ci>b</ci></apply></math>',
    snippets: {},
    convert: (source, display) => fromMathml(source, display),
  },
  {
    id: 'omml',
    label: 'OMML (Word)',
    group: 'Značkovací',
    hint: 'Vzorec zkopírovaný z Wordu. Překládá se na MathML; méně obvyklé prvky se ohlásí.',
    fidelity: 'partial',
    aliases: ['omml', 'word'],
    sample: '<m:oMath><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:oMath>',
    snippets: {},
    convert: (source) => fromOmml(source),
  },
  {
    id: 'asciimath',
    label: 'AsciiMath',
    group: 'Lineární',
    hint: 'Píše se, jak se čte: sum_(i=1)^n i^2. Nejsnazší zápis ze všech.',
    fidelity: 'mapped',
    aliases: ['asciimath', 'am'],
    sample: 'sum_(i=1)^n i^2',
    snippets: ASCIIMATH_SNIPPETS,
    convert: (source) => fromAsciiMath(source),
  },
  {
    id: 'unicodemath',
    label: 'UnicodeMath',
    group: 'Lineární',
    hint: 'Lineární zápis z Wordu: √(x), ∑_(i=1)^n. Znaky se píší rovnou.',
    fidelity: 'mapped',
    aliases: ['unicodemath', 'um'],
    sample: '(3^k)/(2^n)',
    snippets: UNICODEMATH_SNIPPETS,
    convert: (source) => fromUnicodeMath(source),
  },
  {
    id: 'eqn',
    label: 'eqn / neqn',
    group: 'Lineární',
    hint: 'Preprocesor troffu: a over b, x sup 2, int from 0 to 1.',
    fidelity: 'partial',
    aliases: ['eqn', 'neqn'],
    sample: '3 sup k over 2 sup n',
    snippets: EQN_SNIPPETS,
    convert: (source) => fromEqn(source),
  },
  {
    id: 'typst',
    label: 'Typst',
    group: 'Lineární',
    hint: 'Matematika Typstu: frac(a, b), alpha bez lomítka, sum_(i=1)^n.',
    fidelity: 'partial',
    aliases: ['typst'],
    sample: 'frac(3^k, 2^n)',
    snippets: TYPST_SNIPPETS,
    convert: (source) => fromTypst(source),
  },
  {
    id: 'wolfram',
    label: 'Wolfram Language',
    group: 'Výpočetní',
    hint: 'Sqrt[x], Integrate[f, {x,0,1}] i infixový zápis. Nepočítá se, jen sází.',
    fidelity: 'partial',
    aliases: ['wolfram', 'mathematica', 'wl'],
    sample: 'Divide[Power[3, k], Power[2, n]]',
    snippets: WOLFRAM_SNIPPETS,
    convert: (source) => fromWolfram(source),
  },
  {
    id: 'mathjson',
    label: 'MathJSON',
    group: 'Výpočetní',
    hint: 'Výraz jako JSON: ["Divide", 1, 2]. Strojově čitelné, bez hádání.',
    fidelity: 'mapped',
    aliases: ['mathjson'],
    sample: '["Divide", ["Power", 3, "k"], ["Power", 2, "n"]]',
    snippets: MATHJSON_SNIPPETS,
    convert: (source) => fromMathJson(source),
  },
]

const BY_ID = new Map(MATH_LANGUAGES.map((language) => [language.id, language]))

const BY_ALIAS = new Map<string, MathLanguage>()
for (const language of MATH_LANGUAGES) {
  for (const alias of language.aliases) BY_ALIAS.set(alias.toLowerCase(), language)
}

export const DEFAULT_MATH_LANGUAGE: MathLanguageId = 'latex'

export function mathLanguage(id: MathLanguageId): MathLanguage {
  return BY_ID.get(id) ?? BY_ID.get(DEFAULT_MATH_LANGUAGE)!
}

/** Najít jazyk podle toho, co je napsané za třemi apostrofy. */
export function mathLanguageByAlias(alias: string): MathLanguage | null {
  return BY_ALIAS.get((alias ?? '').trim().toLowerCase()) ?? null
}

/** Je tenhle text název matematického jazyka? Používá renderer Markdownu. */
export function isMathFence(alias: string): boolean {
  return mathLanguageByAlias(alias) !== null
}

/** Jazyky seskupené tak, jak se ukážou v rozbalovacím seznamu. */
export function mathLanguageGroups(): Array<{ name: string; languages: MathLanguage[] }> {
  const groups: Array<{ name: string; languages: MathLanguage[] }> = []
  for (const language of MATH_LANGUAGES) {
    const existing = groups.find((group) => group.name === language.group)
    if (existing) existing.languages.push(language)
    else groups.push({ name: language.group, languages: [language] })
  }
  return groups
}
