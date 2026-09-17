import { describe, expect, it } from 'vitest'

import { applyFormat, type EditorSelection, type FormatId } from './format'

/**
 * Zápis výběru jedním řetězcem: `|` je kurzor, `[...]` je výběr.
 * Test se pak čte jako to, co uživatel vidí na obrazovce.
 */
function parse(marked: string): EditorSelection {
  if (marked.includes('[') && marked.includes(']')) {
    const start = marked.indexOf('[')
    const end = marked.indexOf(']') - 1
    return { text: marked.replace('[', '').replace(']', ''), start, end }
  }
  const start = marked.indexOf('|')
  return { text: marked.replace('|', ''), start, end: start }
}

function show(state: EditorSelection): string {
  if (state.start === state.end) {
    return `${state.text.slice(0, state.start)}|${state.text.slice(state.start)}`
  }
  return `${state.text.slice(0, state.start)}[${state.text.slice(state.start, state.end)}]${state.text.slice(state.end)}`
}

const run = (id: FormatId, marked: string): string => show(applyFormat(id, parse(marked)))

describe('obalující značky', () => {
  it('obalí výběr a nechá ho vybraný', () => {
    expect(run('bold', 'ahoj [světe]')).toBe('ahoj **[světe]**')
    expect(run('italic', '[a]')).toBe('*[a]*')
    expect(run('strike', '[a]')).toBe('~~[a]~~')
    expect(run('highlight', '[a]')).toBe('==[a]==')
    expect(run('code', '[a]')).toBe('`[a]`')
  })

  it('bez výběru vloží ukázku a označí ji, aby ji psaní přepsalo', () => {
    expect(run('bold', 'ahoj |')).toBe('ahoj **[tučný text]**')
    expect(run('code', '|')).toBe('`[kód]`')
  })

  it('druhé kliknutí značky zase sundá', () => {
    // Výběr uvnitř značek.
    expect(run('bold', 'ahoj **[světe]**')).toBe('ahoj [světe]')
    // Výběr včetně značek.
    expect(run('bold', 'ahoj [**světe**]')).toBe('ahoj [světe]')
    expect(run('italic', '[*a*]')).toBe('[a]')
  })

  it('nesundá značku, která tam není celá', () => {
    expect(run('bold', 'ahoj [**světe]')).toBe('ahoj **[**světe]**')
  })

  it('kurzíva uvnitř tučného se nepoplete', () => {
    expect(run('italic', '**[a]**')).toBe('***[a]***')
  })
})

describe('předpony řádků', () => {
  it('nasadí nadpis a druhým kliknutím ho sundá', () => {
    expect(run('h1', '|Nadpis')).toBe('[# Nadpis]')
    expect(run('h1', '|# Nadpis')).toBe('[Nadpis]')
  })

  it('mezi úrovněmi nadpisu přepíná, nehromadí je', () => {
    expect(run('h2', '|# Nadpis')).toBe('[## Nadpis]')
    expect(run('h1', '|### Nadpis')).toBe('[# Nadpis]')
  })

  it('platí na všechny vybrané řádky', () => {
    const state = parse('[jedna\ndva\ntři]')
    expect(applyFormat('ul', state).text).toBe('- jedna\n- dva\n- tři')
  })

  it('číslovaný seznam čísluje popořadě', () => {
    const state = parse('[jedna\ndva\ntři]')
    expect(applyFormat('ol', state).text).toBe('1. jedna\n2. dva\n3. tři')
  })

  it('seznam přepne na úkoly, aniž by se značky sčítaly', () => {
    const state = parse('[- jedna\n- dva]')
    expect(applyFormat('task', state).text).toBe('- [ ] jedna\n- [ ] dva')
  })

  it('sundá předponu, jen když ji mají všechny řádky', () => {
    expect(applyFormat('ul', parse('[- jedna\n- dva]')).text).toBe('jedna\ndva')
    // Jeden řádek ji nemá -> doplní se všem.
    expect(applyFormat('ul', parse('[- jedna\ndva]')).text).toBe('- jedna\n- dva')
  })

  it('prázdné řádky nechá být', () => {
    expect(applyFormat('quote', parse('[jedna\n\ndva]')).text).toBe('> jedna\n\n> dva')
  })

  it('chytne celý řádek i když je kurzor uprostřed', () => {
    expect(run('ul', 'polož|ka')).toBe('[- položka]')
  })
})

describe('bloky', () => {
  it('vloží blok kódu a postaví kurzor dovnitř', () => {
    expect(run('codeblock', '|')).toBe('```\n|\n```')
  })

  it('oddělí blok od okolního textu prázdným řádkem', () => {
    expect(run('rule', 'text|')).toBe('text\n\n---|')
  })

  it('prázdné řádky nezdvojuje', () => {
    expect(run('rule', 'text\n\n|')).toBe('text\n\n---|')
  })

  it('vloží tabulku s hlavičkou', () => {
    const { text } = applyFormat('table', parse('|'))
    expect(text).toBe('| Sloupec | Sloupec |\n| --- | --- |\n|  | |')
  })

  it('vybraný text vloží do první buňky tabulky', () => {
    const { text } = applyFormat('table', parse('[Praha]'))
    expect(text).toContain('| Praha | |')
  })
})

describe('odkazy a obrázky', () => {
  it('z vybraného textu udělá popisek a kurzor nechá na adrese', () => {
    const { text, start, end } = applyFormat('link', parse('[Reader]'))
    expect(text).toBe('[Reader](https://)')
    expect(text.slice(start, end)).toBe('https://')
  })

  it('vybranou adresu pozná a dá ji do závorky', () => {
    const { text, start, end } = applyFormat('link', parse('[https://example.com]'))
    expect(text).toBe('[text odkazu](https://example.com)')
    // Kurzor je na popisku, protože adresu už uživatel má.
    expect(text.slice(start, end)).toBe('text odkazu')
  })

  it('odkaz na poznámku se přepíná jako ostatní značky', () => {
    // Bez pomocné notace: hranaté závorky v ní znamenají výběr, a tady jsou
    // hranaté závorky zároveň tou značkou.
    expect(applyFormat('wikilink', { text: 'Plán', start: 0, end: 4 }).text).toBe('[[Plán]]')
    expect(applyFormat('wikilink', { text: '[[Plán]]', start: 0, end: 8 }).text).toBe('Plán')
    expect(applyFormat('wikilink', { text: '[[Plán]]', start: 2, end: 6 }).text).toBe('Plán')
  })

  it('obrázek nechá kurzor na cestě k souboru', () => {
    const { text, start, end } = applyFormat('image', parse('[schéma]'))
    expect(text).toBe('![schéma](cesta/k/obrazku.png)')
    expect(text.slice(start, end)).toBe('cesta/k/obrazku.png')
  })
})

describe('vzorce', () => {
  it('vzorec v řádku obalí dolary', () => {
    expect(run('mathInline', '[E = mc^2]')).toBe('$[E = mc^2]$')
    expect(run('mathInline', '|')).toBe('$[E = mc^2]$')
  })

  it('vzorec v řádku se dá zase sundat', () => {
    expect(applyFormat('mathInline', parse('[$x$]')).text).toBe('x')
  })

  it('samostatný vzorec vloží jako vlastní blok', () => {
    expect(run('mathBlock', '|')).toBe('$$\n|\n$$')
    expect(run('mathBlock', 'text|')).toBe('text\n\n$$\n|\n$$')
  })

  it('vybraný text vloží dovnitř bloku vzorce', () => {
    const { text } = applyFormat('mathBlock', parse('[a^2 + b^2]'))
    expect(text).toBe('$$\na^2 + b^2\n$$')
  })
})

describe('okrajové případy', () => {
  it('neumí spadnout na pozicích mimo text', () => {
    expect(() => applyFormat('bold', { text: 'a', start: 99, end: 150 })).not.toThrow()
    expect(applyFormat('bold', { text: 'a', start: -5, end: 1 }).text).toBe('**a**')
  })

  it('prázdný dokument zvládne taky', () => {
    expect(applyFormat('h1', { text: '', start: 0, end: 0 })).toEqual({ text: '# ', start: 2, end: 2 })
  })
})
