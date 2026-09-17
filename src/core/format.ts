/**
 * Co dělají tlačítka v liště nad editorem.
 *
 * Celé je to čistá funkce `(text, výběr, co) -> (text, výběr)`. Komponenta
 * v Reactu jenom přečte textareu, zavolá tohle a výsledek zapíše zpátky, takže
 * chování lišty se dá otestovat bez jediného kliknutí.
 *
 * Tři pravidla, která odlišují použitelnou lištu od nepoužitelné:
 *
 *   1. **Tlačítka přepínají.** Druhé kliknutí na tučné písmo ho zase sundá,
 *      stejně jako ve Wordu. Bez toho se ve zdroji hromadí `****text****`.
 *   2. **Bez výběru se vloží ukázkový text a rovnou se označí**, takže psaní
 *      ho přepíše. Holý kurzor mezi dvěma hvězdičkami nikomu nepomůže.
 *   3. **Předpony řádků platí na všechny vybrané řádky**, ne jen na ten první.
 */

export type FormatId =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'highlight'
  | 'code'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'ul'
  | 'ol'
  | 'task'
  | 'quote'
  | 'codeblock'
  | 'table'
  | 'rule'
  | 'link'
  | 'wikilink'
  | 'image'
  | 'mathInline'
  | 'mathBlock'

export interface EditorSelection {
  text: string
  start: number
  end: number
}

/** Ukázkový text, který se vloží, když uživatel nic nevybral. */
const SAMPLE: Partial<Record<FormatId, string>> = {
  bold: 'tučný text',
  italic: 'kurzíva',
  strike: 'škrtnuté',
  highlight: 'zvýrazněné',
  code: 'kód',
  h1: 'Nadpis',
  h2: 'Nadpis',
  h3: 'Nadpis',
  quote: 'citace',
  ul: 'položka',
  ol: 'položka',
  task: 'úkol',
  link: 'text odkazu',
  wikilink: 'Jiná poznámka',
  image: 'popis obrázku',
  mathInline: 'E = mc^2',
}

function clamp(state: EditorSelection): { text: string; start: number; end: number } {
  const text = state.text ?? ''
  const start = Math.max(0, Math.min(state.start, text.length))
  const end = Math.max(start, Math.min(state.end, text.length))
  return { text, start, end }
}

/**
 * Obalit výběr značkami, nebo je sundat, když už tam jsou.
 *
 * Kontrolují se obě možnosti: značky uvnitř výběru (uživatel označil
 * `**text**` včetně hvězdiček) i těsně kolem něj (označil jen `text`).
 */
function toggleWrap(
  state: EditorSelection,
  before: string,
  after: string,
  sample: string,
): EditorSelection {
  const { text, start, end } = clamp(state)
  const selected = text.slice(start, end)

  // `*` a `**` jsou ze stejného znaku, takže se dají snadno splést. Když kolem
  // dokola zbývá další stejný znak, nejde o naši značku, ale o vnořenou --
  // kurzíva uvnitř tučného musí přidat hvězdičku, ne jednu ubrat.
  const marker = before.charAt(0)
  const repeated =
    marker !== '' &&
    before.split('').every((char) => char === marker) &&
    after.split('').every((char) => char === marker)

  // Značky uvnitř výběru.
  if (
    selected.length >= before.length + after.length &&
    selected.startsWith(before) &&
    selected.endsWith(after)
  ) {
    const inner = selected.slice(before.length, selected.length - after.length)
    const nested = repeated && (inner.startsWith(marker) || inner.endsWith(marker))
    if (!nested) {
      return {
        text: text.slice(0, start) + inner + text.slice(end),
        start,
        end: start + inner.length,
      }
    }
  }

  // Značky těsně kolem výběru.
  const leading = text.slice(Math.max(0, start - before.length), start)
  const trailing = text.slice(end, end + after.length)
  const nestedOutside =
    repeated &&
    (text.charAt(start - before.length - 1) === marker || text.charAt(end + after.length) === marker)
  if (leading === before && trailing === after && !nestedOutside) {
    const from = start - before.length
    return {
      text: text.slice(0, from) + selected + text.slice(end + after.length),
      start: from,
      end: from + selected.length,
    }
  }

  const body = selected || sample
  return {
    text: text.slice(0, start) + before + body + after + text.slice(end),
    start: start + before.length,
    end: start + before.length + body.length,
  }
}

/** Hranice řádků, kterých se výběr dotýká. */
function lineRange(text: string, start: number, end: number): { from: number; to: number } {
  const from = text.lastIndexOf('\n', start - 1) + 1
  const newline = text.indexOf('\n', end)
  // Prázdný výběr na začátku řádku bere ten řádek, ne předchozí.
  const to = newline === -1 ? text.length : newline
  return { from, to }
}

/** Kolik znaků na začátku řádku tvoří značku seznamu, citace nebo nadpisu. */
function prefixLength(line: string, kind: FormatId): number {
  const patterns: Partial<Record<FormatId, RegExp>> = {
    h1: /^#{1,6} /,
    h2: /^#{1,6} /,
    h3: /^#{1,6} /,
    quote: /^> ?/,
    ul: /^[-*+] (?!\[[ xX]\] )/,
    ol: /^\d+\. /,
    task: /^[-*+] \[[ xX]\] /,
  }
  const pattern = patterns[kind]
  if (!pattern) return 0
  return pattern.exec(line)?.[0].length ?? 0
}

/** Jakoukoli značku na začátku řádku, ať je to nadpis, seznam nebo citace. */
const ANY_PREFIX = /^(?:#{1,6} |> ?|[-*+] \[[ xX]\] |[-*+] |\d+\. )/

/**
 * Nasadit nebo sundat předponu na každém vybraném řádku.
 *
 * Když ji mají všechny řádky, sundá se; jinak se doplní tam, kde chybí. To je
 * chování, které lidé od takového tlačítka čekají, i když si to neuvědomují.
 */
function toggleLinePrefix(state: EditorSelection, kind: FormatId): EditorSelection {
  const { text, start, end } = clamp(state)
  const { from, to } = lineRange(text, start, end)
  const block = text.slice(from, to)
  const lines = block.split('\n')

  const prefixFor = (index: number): string => {
    switch (kind) {
      case 'h1':
        return '# '
      case 'h2':
        return '## '
      case 'h3':
        return '### '
      case 'quote':
        return '> '
      case 'ul':
        return '- '
      case 'ol':
        return `${index + 1}. `
      case 'task':
        return '- [ ] '
      default:
        return ''
    }
  }

  const nonEmpty = lines.filter((line) => line.trim() !== '')

  // Prázdná poznámka je pořád poznámka: kliknutí na nadpis má vypsat `# `
  // a nechat kurzor za ním, ne mlčky neudělat nic.
  if (nonEmpty.length === 0) {
    const prefix =
      kind === 'h1'
        ? '# '
        : kind === 'h2'
          ? '## '
          : kind === 'h3'
            ? '### '
            : kind === 'quote'
              ? '> '
              : kind === 'ul'
                ? '- '
                : kind === 'ol'
                  ? '1. '
                  : kind === 'task'
                    ? '- [ ] '
                    : ''
    const caret = from + prefix.length
    return { text: text.slice(0, from) + prefix + text.slice(from), start: caret, end: caret }
  }

  const allHave =
    nonEmpty.length > 0 &&
    nonEmpty.every((line) => {
      if (kind === 'h1' || kind === 'h2' || kind === 'h3') {
        // Nadpisy se přepínají podle úrovně: z `##` na `#` se přepíše, ne sundá.
        return line.startsWith(prefixFor(0))
      }
      return prefixLength(line, kind) > 0
    })

  let counter = 0
  const next = lines.map((line) => {
    if (line.trim() === '') return line
    const existing = ANY_PREFIX.exec(line)?.[0].length ?? 0
    const bare = line.slice(existing)
    if (allHave) return bare
    const prefix = prefixFor(counter)
    counter += 1
    return prefix + bare
  })

  const replaced = next.join('\n')
  return {
    text: text.slice(0, from) + replaced + text.slice(to),
    start: from,
    end: from + replaced.length,
  }
}

/**
 * Vložit samostatný blok (tabulku, blok kódu, vzorec) jako vlastní odstavec.
 *
 * `$1` je místo pro kurzor. Kolem bloku se doplní prázdné řádky jen tam, kde
 * ještě nejsou -- jinak by se při každém vložení text roztrhal víc a víc.
 */
function insertBlock(state: EditorSelection, block: string): EditorSelection {
  const { text, start, end } = clamp(state)
  const selected = text.slice(start, end)
  const filled = block.includes('$1') ? block.replace('$1', selected) : block

  const before = text.slice(0, start)
  const after = text.slice(end)
  const lead = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
  const tail = after === '' || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n'

  const body = lead + filled + tail
  const hole = block.indexOf('$1')
  const caret =
    hole === -1 ? start + lead.length + filled.length : start + lead.length + hole + selected.length

  return {
    text: before + body + after,
    start: caret,
    end: caret,
  }
}

const TABLE = ['| Sloupec | Sloupec |', '| --- | --- |', '| $1 | |'].join('\n')

/**
 * Vložit hotový vzorec z editoru vzorců.
 *
 * Blokový vzorec chce kolem sebe prázdné řádky, aby ho renderer viděl jako
 * samostatný blok; vzorec v řádku se naopak vloží přesně tam, kde je kurzor.
 */
export function insertMath(state: EditorSelection, tex: string, display: boolean): EditorSelection {
  if (display) return insertBlock(state, `$$\n${tex}\n$$`)

  const { text, start, end } = clamp(state)
  const inserted = `$${tex}$`
  const caret = start + inserted.length
  return { text: text.slice(0, start) + inserted + text.slice(end), start: caret, end: caret }
}

/**
 * Přepsat konkrétní úsek textu -- použije se, když se upravuje vzorec, na který
 * uživatel klikl v náhledu.
 */
export function replaceRange(
  state: EditorSelection,
  from: number,
  to: number,
  replacement: string,
): EditorSelection {
  const text = state.text ?? ''
  const start = Math.max(0, Math.min(from, text.length))
  const end = Math.max(start, Math.min(to, text.length))
  const caret = start + replacement.length
  return {
    text: text.slice(0, start) + replacement + text.slice(end),
    start: caret,
    end: caret,
  }
}

/**
 * Najít ve zdroji vzorec, jehož LaTeX přesně odpovídá zadanému.
 *
 * Náhled si na každém vzorci nese `data-tex`, takže po kliknutí víme, co
 * hledat -- ale ne kde to je. Vrací i delimitery, aby se dal přepsat celý
 * zápis včetně dolarů. `null`, když se nic nenajde.
 */
export function findMathSource(
  text: string,
  tex: string,
): { from: number; to: number; display: boolean } | null {
  const source = text ?? ''
  const needle = (tex ?? '').trim()
  if (!needle) return null

  // Nejdřív blokové zápisy, protože `$$x$$` obsahuje i `$x$`.
  for (const [open, close, display] of [
    ['$$\n', '\n$$', true],
    ['$$', '$$', true],
    ['$', '$', false],
  ] as const) {
    const pattern = open + needle + close
    const index = source.indexOf(pattern)
    if (index !== -1) return { from: index, to: index + pattern.length, display }
  }
  return null
}

/** Provést to, na co se v liště kliklo. */
export function applyFormat(id: FormatId, state: EditorSelection): EditorSelection {
  const sample = SAMPLE[id] ?? ''

  switch (id) {
    case 'bold':
      return toggleWrap(state, '**', '**', sample)
    case 'italic':
      return toggleWrap(state, '*', '*', sample)
    case 'strike':
      return toggleWrap(state, '~~', '~~', sample)
    case 'highlight':
      return toggleWrap(state, '==', '==', sample)
    case 'code':
      return toggleWrap(state, '`', '`', sample)
    case 'mathInline':
      return toggleWrap(state, '$', '$', sample)

    case 'h1':
    case 'h2':
    case 'h3':
    case 'ul':
    case 'ol':
    case 'task':
    case 'quote':
      return toggleLinePrefix(state, id)

    case 'codeblock':
      return insertBlock(state, '```\n$1\n```')
    case 'table':
      return insertBlock(state, TABLE)
    case 'rule':
      return insertBlock(state, '---')
    case 'mathBlock':
      return insertBlock(state, '$$\n$1\n$$')

    case 'link': {
      const { text, start, end } = clamp(state)
      const selected = text.slice(start, end)
      // Označená adresa patří do závorky, označený text před ni.
      const isUrl = /^(https?:\/\/|www\.|mailto:)/i.test(selected.trim())
      const label = isUrl ? sample : selected || sample
      const href = isUrl ? selected.trim() : 'https://'
      const inserted = `[${label}](${href})`
      // Kurzor na tu část, kterou bude uživatel dopisovat.
      const from = isUrl ? start + 1 : start + inserted.length - href.length - 1
      const to = isUrl ? from + label.length : from + href.length
      return { text: text.slice(0, start) + inserted + text.slice(end), start: from, end: to }
    }

    case 'wikilink':
      return toggleWrap(state, '[[', ']]', sample)

    case 'image': {
      const { text, start, end } = clamp(state)
      const selected = text.slice(start, end)
      const alt = selected || sample
      const inserted = `![${alt}](cesta/k/obrazku.png)`
      const from = start + inserted.length - 'cesta/k/obrazku.png'.length - 1
      return { text: text.slice(0, start) + inserted + text.slice(end), start: from, end: from + 'cesta/k/obrazku.png'.length }
    }

    default:
      return clamp(state)
  }
}
