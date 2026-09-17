/**
 * Značkovací jazyky: MathML, OMML, AsciiMath, UnicodeMath.
 *
 * AsciiMath a UnicodeMath mají hotovou a odzkoušenou knihovnu, takže je tenhle
 * soubor jen obal, který sjednotí jejich rozhraní, umyje vstup a přeloží jejich
 * hlášky do češtiny. MathML a OMML se zpracují tady.
 *
 * MathML má zvláštní postavení: WebView je Chromium a to MathML vykresluje
 * samo. Prezentační MathML tak jde rovnou na obrazovku, bez mezikroku přes
 * LaTeX -- což je nejvěrnější možná cesta, protože se nic nepřekládá.
 */

import asciimathToLatex from 'asciimath-to-latex'
import { convertUnicodeMathToMathML } from 'unicodemathml'

import { fromContentMathml } from './mathml-content'
import { ok, viaMathml, type MathConversion } from './types'

/** Knihovna je v CommonJS i ESM podobě podle toho, kdo ji zabalil. */
const toLatexFromAsciiMath = (
  (asciimathToLatex as unknown as { default?: (input: string) => string }).default ??
  (asciimathToLatex as unknown as (input: string) => string)
)

export function fromAsciiMath(source: string): MathConversion {
  const text = source.trim()
  if (!text) return ok('')
  try {
    return ok(toLatexFromAsciiMath(text).trim())
  } catch (error) {
    return ok('', [`AsciiMath se nepodařilo přečíst. ${describe(error)}`.trim()])
  }
}

/**
 * Co je uvnitř `<math>` -- prezentační, nebo obsahové MathML?
 *
 * Prezentační popisuje, jak vzorec vypadá (`<mfrac>`, `<msup>`), obsahové co
 * znamená (`<apply><divide/>`). Prohlížeč umí jen to první.
 */
const CONTENT_ELEMENTS = /<\s*(apply|cn|ci|csymbol|bvar|declare|lambda|semantics\b[^>]*content)/i

export function isContentMathml(source: string): boolean {
  return CONTENT_ELEMENTS.test(source)
}

/**
 * Prezentační MathML jde rovnou na obrazovku.
 *
 * Nesmí se to plést s důvěrou ve vstup: značky se propouští přes bílou listinu
 * a atributy s událostmi i odkazy jdou pryč, protože výsledek končí
 * v `dangerouslySetInnerHTML` stejně jako všechno ostatní.
 */
const ALLOWED_TAGS = new Set([
  'math', 'semantics', 'annotation', 'annotation-xml',
  'mrow', 'mi', 'mn', 'mo', 'ms', 'mtext', 'mspace',
  'mfrac', 'msqrt', 'mroot', 'mstyle', 'merror', 'mpadded', 'mphantom',
  'mfenced', 'menclose', 'msub', 'msup', 'msubsup', 'munder', 'mover',
  'munderover', 'mmultiscripts', 'mprescripts', 'none',
  'mtable', 'mtr', 'mtd', 'maligngroup', 'malignmark', 'maction',
])

const ALLOWED_ATTRIBUTES = /^(display|mathvariant|mathsize|mathcolor|mathbackground|dir|stretchy|fence|separator|accent|accentunder|lspace|rspace|width|height|depth|linethickness|columnalign|rowalign|columnspacing|rowspacing|open|close|separators|notation|scriptlevel|displaystyle|form|largeop|movablelimits|symmetric|maxsize|minsize|xmlns|encoding|columnlines|rowlines|frame|align)$/i

export function sanitizeMathml(source: string): { mathml: string; warnings: string[] } {
  const warnings: string[] = []
  const removed = new Set<string>()

  let text = source
    // Komentáře a instrukce pryč; v matematice nemají co dělat.
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')

  text = text.replace(/<\s*(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>])*)>/g,
    (_full, slash: string, rawTag: string, attributes: string) => {
      const tag = rawTag.includes(':') ? rawTag.slice(rawTag.indexOf(':') + 1) : rawTag
      if (!ALLOWED_TAGS.has(tag.toLowerCase())) {
        removed.add(tag)
        return ''
      }
      if (slash) return `</${tag}>`

      const kept = attributes.replace(
        /([a-zA-Z][\w:-]*)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g,
        (attr: string, name: string, value: string) => {
          const bare = name.includes(':') ? name.slice(name.indexOf(':') + 1) : name
          if (!ALLOWED_ATTRIBUTES.test(bare)) return ''
          // Ani povolený atribut nesmí nést `javascript:`.
          if (/javascript:/i.test(value)) return ''
          void attr
          return ` ${bare}=${value.startsWith('"') || value.startsWith("'") ? value : `"${value}"`}`
        },
      )
      const selfClosing = /\/\s*$/.test(attributes) ? ' /' : ''
      return `<${tag}${kept.replace(/\s+/g, ' ').trimEnd()}${selfClosing}>`
    },
  )

  if (removed.size > 0) {
    warnings.push(`Značky ${[...removed].join(', ')} do MathML nepatří, vynechal jsem je.`)
  }
  if (!/<math[\s>]/i.test(text)) {
    text = `<math xmlns="http://www.w3.org/1998/Math/MathML">${text}</math>`
  }
  return { mathml: text.trim(), warnings }
}

export function fromMathml(source: string, display: boolean): MathConversion {
  const text = source.trim()
  if (!text) return ok('')

  if (isContentMathml(text)) {
    // Obsahové MathML prohlížeč nevykreslí a knihovna na to prezentační si
    // s ním neporadí -- překládá se vlastním průchodem stromem.
    return fromContentMathml(text)
  }

  const { mathml, warnings } = sanitizeMathml(text)
  // `display="block"` říká prohlížeči, že vzorec stojí na vlastním řádku.
  const withDisplay = display
    ? mathml.replace(/<math\b/i, '<math display="block"')
    : mathml.replace(/\s+display="block"/i, '')
  return viaMathml(withDisplay, warnings)
}

/**
 * OMML -- matematika ve formátu Wordu.
 *
 * Word ji ukládá jako XML s předponou `m:` (`<m:f>` zlomek, `<m:rad>`
 * odmocnina). Struktura je blízká prezentačnímu MathML, jen jinak
 * pojmenovaná, takže se přejmenuje a pošle dál stejnou cestou.
 */
const OMML_TO_MATHML: Array<[RegExp, string]> = [
  [/<\/?m:oMathPara[^>]*>/g, ''],
  [/<\/?m:oMath[^>]*>/g, ''],
  [/<m:f>/g, '<mfrac>'], [/<\/m:f>/g, '</mfrac>'],
  [/<m:num>/g, '<mrow>'], [/<\/m:num>/g, '</mrow>'],
  [/<m:den>/g, '<mrow>'], [/<\/m:den>/g, '</mrow>'],
  [/<m:rad>/g, '<msqrt>'], [/<\/m:rad>/g, '</msqrt>'],
  [/<m:sup>/g, '<mrow>'], [/<\/m:sup>/g, '</mrow>'],
  [/<m:sub>/g, '<mrow>'], [/<\/m:sub>/g, '</mrow>'],
  [/<m:e>/g, '<mrow>'], [/<\/m:e>/g, '</mrow>'],
  [/<m:r>/g, '<mrow>'], [/<\/m:r>/g, '</mrow>'],
  [/<m:d>/g, '<mrow>'], [/<\/m:d>/g, '</mrow>'],
  [/<m:nary>/g, '<mrow>'], [/<\/m:nary>/g, '</mrow>'],
  // Vlastnosti a formátování nenesou obsah.
  [/<m:[a-zA-Z]+Pr>[\s\S]*?<\/m:[a-zA-Z]+Pr>/g, ''],
  [/<m:ctrlPr>[\s\S]*?<\/m:ctrlPr>/g, ''],
  [/<w:[^>]*>/g, ''], [/<\/w:[^>]*>/g, ''],
]

export function fromOmml(source: string): MathConversion {
  const text = source.trim()
  if (!text) return ok('')

  const warnings: string[] = []
  let converted = text
  for (const [pattern, replacement] of OMML_TO_MATHML) {
    converted = converted.replace(pattern, replacement)
  }

  // `<m:sSup>` a spol. nesou strukturu indexů; přeložit je přesně znamená
  // vědět, co je základ a co index, což plochá náhrada neumí.
  if (/<m:(sSup|sSub|sSubSup|limLow|limUpp)\b/.test(text)) {
    converted = converted
      .replace(/<m:sSubSup>/g, '<msubsup>').replace(/<\/m:sSubSup>/g, '</msubsup>')
      .replace(/<m:sSup>/g, '<msup>').replace(/<\/m:sSup>/g, '</msup>')
      .replace(/<m:sSub>/g, '<msub>').replace(/<\/m:sSub>/g, '</msub>')
      .replace(/<m:limLow>/g, '<munder>').replace(/<\/m:limLow>/g, '</munder>')
      .replace(/<m:limUpp>/g, '<mover>').replace(/<\/m:limUpp>/g, '</mover>')
  }

  // `<m:t>` je text; podle obsahu je to číslo, operátor nebo proměnná.
  converted = converted.replace(/<m:t[^>]*>([\s\S]*?)<\/m:t>/g, (_full, content: string) => {
    const value = content.trim()
    if (!value) return ''
    if (/^[0-9.,]+$/.test(value)) return `<mn>${value}</mn>`
    if (/^[A-Za-zÀ-ɏ]+$/.test(value)) return `<mi>${value}</mi>`
    return `<mo>${value}</mo>`
  })

  const leftover = converted.match(/<\/?m:[a-zA-Z]+/g)
  if (leftover) {
    warnings.push(
      `Prvky ${[...new Set(leftover.map((t) => t.replace(/[<\/]/g, '')))].join(', ')} zatím nepřekládám.`,
    )
    converted = converted.replace(/<\/?m:[a-zA-Z]+[^>]*>/g, '')
  }

  const { mathml, warnings: sanitizeWarnings } = sanitizeMathml(converted)
  return { latex: '', mathml, warnings: [...warnings, ...sanitizeWarnings] }
}

/**
 * UnicodeMath -- lineární zápis z Wordu.
 *
 * `a/b` je zlomek, `√(x)` odmocnina, `∑_(i=1)^n` suma. Knihovna to převede na
 * MathML, odkud už vede známá cesta.
 */
export function fromUnicodeMath(source: string): MathConversion {
  const text = source.trim()
  if (!text) return ok('')
  try {
    const result = convertUnicodeMathToMathML(text) as unknown
    const mathml = typeof result === 'string' ? result : String((result as { mathml?: string })?.mathml ?? '')
    if (!mathml.trim()) {
      return ok('', ['Z tohohle zápisu UnicodeMath se nepodařilo nic vysázet.'])
    }
    const { mathml: clean, warnings } = sanitizeMathml(mathml)
    return { latex: '', mathml: clean, warnings }
  } catch (error) {
    return ok('', [`UnicodeMath se nepodařilo přečíst. ${describe(error)}`.trim()])
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message.split('\n')[0]! : ''
}
