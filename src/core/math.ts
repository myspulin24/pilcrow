/**
 * Matematické vzorce.
 *
 * Renderer Markdownu je psaný ručně, protože potřebuje věci, které běžná
 * knihovna neumí. U matematiky je to naopak: sázení zlomků, mocnin
 * a roztažených závorek je stará, vyřešená a nesmírně pracná úloha. Proto
 * KaTeX -- běží celý místně, nic nestahuje a je to jediná knihovna, kterou
 * do jádra pouštíme.
 *
 * Dvě nastavení stojí za vysvětlení:
 *
 *   - `strict: false` -- KaTeX jinak nadává na písmena s diakritikou
 *     v matematickém režimu. Vysází je správně, jen si u toho stěžuje, a
 *     `B_{přímý}` je přesně to, co tady někdo napíše.
 *   - `throwOnError: false` při vykreslování -- rozepsaný vzorec je půlku času
 *     nedopsaný. Červeně vysázený zdroj je lepší zpětná vazba než prázdný
 *     náhled nebo rozbitá stránka.
 */

import katex from 'katex'

export interface MathResult {
  html: string
  /** Popis chyby, když se vzorec nepovedlo přečíst. `null` = v pořádku. */
  error: string | null
}

const OPTIONS = {
  throwOnError: false as const,
  strict: false as const,
  // Ponecháváme i MathML: čtečky obrazovky pak vzorec přečtou jako vzorec,
  // ne jako hromadu rozsypaných písmen.
  output: 'htmlAndMathml' as const,
  // Žádné `\href` ani `\includegraphics` -- vzorec nesmí umět víc než sázet.
  trust: false as const,
  // `\newcommand` v jedné poznámce nesmí ovlivnit jinou.
  globalGroup: false as const,
}

/** Přeložit chybu KaTeXu do češtiny, pokud jí rozumíme. */
function describe(message: string): string {
  const text = message.replace(/^KaTeX parse error:\s*/i, '')
  if (/Undefined control sequence:\s*(\S+)/i.test(text)) {
    const command = /Undefined control sequence:\s*(\S+)/i.exec(text)?.[1] ?? ''
    return `Neznámý příkaz ${command}.`
  }
  if (/Expected '}'|Unexpected end of input/i.test(text)) {
    return 'Vzorec není dopsaný — chybí uzavírací závorka.'
  }
  if (/Double superscript|Double subscript/i.test(text)) {
    return 'Dvakrát za sebou horní nebo dolní index. Dej ten druhý do složených závorek.'
  }
  if (/Unexpected character/i.test(text)) {
    return `Tenhle znak se do vzorce nehodí. ${text}`
  }
  return text
}

/**
 * Vysázet vzorec.
 *
 * `display` = samostatný blok na střed, jinak vzorec v řádku textu.
 * Vrací vždycky nějaké HTML: když se vzorec nepovede, je to jeho zdroj
 * červeně, aby bylo vidět, kde se to zaseklo.
 */
export function renderMath(tex: string, display = false): MathResult {
  const source = (tex ?? '').trim()
  if (!source) return { html: '', error: null }

  let error: string | null = null
  try {
    // První průchod přísně, jen abychom se dozvěděli, co je špatně.
    katex.renderToString(source, { ...OPTIONS, displayMode: display, throwOnError: true })
  } catch (caught) {
    error = describe(caught instanceof Error ? caught.message : String(caught))
  }

  const html = katex.renderToString(source, { ...OPTIONS, displayMode: display })
  return { html, error }
}

/** Jen kontrola: `null` znamená, že je vzorec v pořádku. */
export function validateMath(tex: string): string | null {
  return renderMath(tex, false).error
}

/**
 * Nejčastější značky, seřazené tak, jak se na ně při psaní přijde.
 *
 * `insert` je to, co se vloží; `$1` označuje, kam po vložení skočí kurzor.
 * Používá to paleta v editoru vzorců a testy hlídají, že každý kousek
 * KaTeX opravdu přečte -- jinak by paleta nabízela nefunkční tlačítka.
 */
export interface MathSnippet {
  label: string
  /** Co se vloží. `$1` je místo pro kurzor, `$2` druhé místo. */
  insert: string
  /** Náhled vysázený v paletě. */
  preview: string
  title: string
}

export interface MathGroup {
  name: string
  snippets: MathSnippet[]
}

export const MATH_GROUPS: MathGroup[] = [
  {
    name: 'Základ',
    snippets: [
      { label: 'x²', insert: '$1^{$2}', preview: 'x^{2}', title: 'Mocnina' },
      { label: 'xₙ', insert: '$1_{$2}', preview: 'x_{n}', title: 'Dolní index' },
      { label: 'a/b', insert: String.raw`\frac{$1}{$2}`, preview: String.raw`\frac{a}{b}`, title: 'Zlomek' },
      { label: '√', insert: String.raw`\sqrt{$1}`, preview: String.raw`\sqrt{x}`, title: 'Odmocnina' },
      { label: 'ⁿ√', insert: String.raw`\sqrt[$1]{$2}`, preview: String.raw`\sqrt[n]{x}`, title: 'N-tá odmocnina' },
      { label: '( )', insert: String.raw`\left( $1 \right)`, preview: String.raw`\left(\frac{a}{b}\right)`, title: 'Závorky, které se roztáhnou' },
      { label: '[ ]', insert: String.raw`\left[ $1 \right]`, preview: String.raw`\left[\frac{a}{b}\right]`, title: 'Hranaté závorky' },
      { label: '| |', insert: String.raw`\left| $1 \right|`, preview: String.raw`\left|\frac{a}{b}\right|`, title: 'Absolutní hodnota' },
    ],
  },
  {
    name: 'Operátory',
    snippets: [
      { label: '∑', insert: String.raw`\sum_{$1}^{$2}`, preview: String.raw`\sum_{i=1}^{n}`, title: 'Suma' },
      { label: '∏', insert: String.raw`\prod_{$1}^{$2}`, preview: String.raw`\prod_{i=1}^{n}`, title: 'Součin' },
      { label: '∫', insert: String.raw`\int_{$1}^{$2}`, preview: String.raw`\int_{a}^{b}`, title: 'Integrál' },
      { label: 'lim', insert: String.raw`\lim_{$1}`, preview: String.raw`\lim_{x \to 0}`, title: 'Limita' },
      { label: '±', insert: String.raw`\pm `, preview: String.raw`\pm`, title: 'Plus minus' },
      { label: '·', insert: String.raw`\cdot `, preview: String.raw`\cdot`, title: 'Násobení tečkou' },
      { label: '×', insert: String.raw`\times `, preview: String.raw`\times`, title: 'Násobení křížkem' },
      { label: '÷', insert: String.raw`\div `, preview: String.raw`\div`, title: 'Dělení' },
    ],
  },
  {
    name: 'Vztahy',
    snippets: [
      { label: '≠', insert: String.raw`\neq `, preview: String.raw`\neq`, title: 'Nerovná se' },
      { label: '≤', insert: String.raw`\leq `, preview: String.raw`\leq`, title: 'Menší nebo rovno' },
      { label: '≥', insert: String.raw`\geq `, preview: String.raw`\geq`, title: 'Větší nebo rovno' },
      { label: '≈', insert: String.raw`\approx `, preview: String.raw`\approx`, title: 'Přibližně' },
      { label: '→', insert: String.raw`\to `, preview: String.raw`\to`, title: 'Šipka' },
      { label: '∈', insert: String.raw`\in `, preview: String.raw`\in`, title: 'Je prvkem' },
      { label: '∞', insert: String.raw`\infty `, preview: String.raw`\infty`, title: 'Nekonečno' },
      { label: '∀', insert: String.raw`\forall `, preview: String.raw`\forall`, title: 'Pro všechna' },
    ],
  },
  {
    name: 'Řecká písmena',
    snippets: [
      { label: 'α', insert: String.raw`\alpha `, preview: String.raw`\alpha`, title: 'alfa' },
      { label: 'β', insert: String.raw`\beta `, preview: String.raw`\beta`, title: 'beta' },
      { label: 'γ', insert: String.raw`\gamma `, preview: String.raw`\gamma`, title: 'gama' },
      { label: 'δ', insert: String.raw`\delta `, preview: String.raw`\delta`, title: 'delta' },
      { label: 'π', insert: String.raw`\pi `, preview: String.raw`\pi`, title: 'pí' },
      { label: 'σ', insert: String.raw`\sigma `, preview: String.raw`\sigma`, title: 'sigma' },
      { label: 'φ', insert: String.raw`\varphi `, preview: String.raw`\varphi`, title: 'fí' },
      { label: 'Δ', insert: String.raw`\Delta `, preview: String.raw`\Delta`, title: 'velká delta' },
      { label: 'Ω', insert: String.raw`\Omega `, preview: String.raw`\Omega`, title: 'omega' },
      { label: 'μ', insert: String.raw`\mu `, preview: String.raw`\mu`, title: 'mí' },
      { label: 'λ', insert: String.raw`\lambda `, preview: String.raw`\lambda`, title: 'lambda' },
      { label: 'θ', insert: String.raw`\theta `, preview: String.raw`\theta`, title: 'théta' },
    ],
  },
  {
    name: 'Struktury',
    snippets: [
      {
        label: 'Matice',
        insert: String.raw`\begin{pmatrix} $1 & $2 \\ c & d \end{pmatrix}`,
        preview: String.raw`\begin{pmatrix} a & b \\ c & d \end{pmatrix}`,
        title: 'Matice v kulatých závorkách',
      },
      {
        label: 'Případy',
        insert: String.raw`\begin{cases} $1 & \text{pokud } x > 0 \\ $2 & \text{jinak} \end{cases}`,
        preview: String.raw`\begin{cases} a & x > 0 \\ b & \text{jinak} \end{cases}`,
        title: 'Rozdělení na případy',
      },
      {
        label: 'Text',
        insert: String.raw`\text{$1}`,
        preview: String.raw`\text{slovo}`,
        title: 'Obyčejný text uvnitř vzorce',
      },
      {
        label: 'x̄',
        insert: String.raw`\overline{$1}`,
        preview: String.raw`\overline{x}`,
        title: 'Vodorovná čára nad' },
      { label: 'x̂', insert: String.raw`\hat{$1}`, preview: String.raw`\hat{x}`, title: 'Stříška' },
      { label: 'x⃗', insert: String.raw`\vec{$1}`, preview: String.raw`\vec{x}`, title: 'Vektor' },
    ],
  },
]

/**
 * Vložit značku na pozici kurzoru.
 *
 * `$1` a `$2` jsou místa pro kurzor. Když je ve vzorci něco vybráno, vybraný
 * text se dosadí do `$1` -- takže označit `x` a kliknout na odmocninu udělá
 * `\sqrt{x}`, ne `\sqrt{}` vedle.
 */
export function applySnippet(
  tex: string,
  selectionStart: number,
  selectionEnd: number,
  insert: string,
): { tex: string; selectionStart: number; selectionEnd: number } {
  const source = tex ?? ''
  const start = Math.max(0, Math.min(selectionStart, source.length))
  const end = Math.max(start, Math.min(selectionEnd, source.length))
  const selected = source.slice(start, end)

  // Jedním průchodem, ne přes `replace`: jakmile se do `$1` dosadí výběr,
  // posunou se všechny pozice za ním a index `$2` spočítaný předem už nesedí.
  const target = selected ? '$2' : '$1'
  let filled = ''
  let caretOffset = -1
  let i = 0
  while (i < insert.length) {
    const token = insert.slice(i, i + 2)
    if (token === '$1' || token === '$2') {
      if (token === target && caretOffset === -1) caretOffset = filled.length
      if (token === '$1') filled += selected
      i += 2
      continue
    }
    filled += insert[i]
    i += 1
  }
  if (caretOffset === -1) caretOffset = filled.length

  const caret = start + caretOffset
  return {
    tex: source.slice(0, start) + filled + source.slice(end),
    selectionStart: caret,
    selectionEnd: caret,
  }
}
