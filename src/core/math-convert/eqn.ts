/**
 * eqn / neqn -- preprocesor pro troff.
 *
 * Jazyk z roku 1975, který stojí na dvou nápadech: mezery oddělují prvky
 * a klíčová slova jsou infixová. `a over b` je zlomek, `x sup 2` mocnina,
 * `int from 0 to 1` integrál s mezemi. Skupiny se drží ve složených závorkách.
 *
 * Gramatika je malá, takže se dá přeložit poctivě, ne jen odhadem. Překládá se
 * rekurzivním sestupem podle priorit, jak je popisuje původní manuál:
 *
 *   1. `from` / `to`     (meze, nejvolnější)
 *   2. `over`            (zlomek)
 *   3. `sup` / `sub`     (indexy, váží doprava)
 *   4. `sqrt`, prefixy
 *   5. prvky a skupiny
 */

import { ok, type MathConversion } from './types'

/** Slova, která eqn překládá na řecká písmena a značky. */
const WORDS: Record<string, string> = {
  alpha: String.raw`\alpha`, beta: String.raw`\beta`, gamma: String.raw`\gamma`,
  delta: String.raw`\delta`, epsilon: String.raw`\epsilon`, zeta: String.raw`\zeta`,
  eta: String.raw`\eta`, theta: String.raw`\theta`, iota: String.raw`\iota`,
  kappa: String.raw`\kappa`, lambda: String.raw`\lambda`, mu: String.raw`\mu`,
  nu: String.raw`\nu`, xi: String.raw`\xi`, pi: String.raw`\pi`, rho: String.raw`\rho`,
  sigma: String.raw`\sigma`, tau: String.raw`\tau`, upsilon: String.raw`\upsilon`,
  phi: String.raw`\phi`, chi: String.raw`\chi`, psi: String.raw`\psi`, omega: String.raw`\omega`,
  GAMMA: String.raw`\Gamma`, DELTA: String.raw`\Delta`, THETA: String.raw`\Theta`,
  LAMBDA: String.raw`\Lambda`, XI: String.raw`\Xi`, PI: String.raw`\Pi`,
  SIGMA: String.raw`\Sigma`, UPSILON: String.raw`\Upsilon`, PHI: String.raw`\Phi`,
  PSI: String.raw`\Psi`, OMEGA: String.raw`\Omega`,
  inf: String.raw`\infty`, infinity: String.raw`\infty`, partial: String.raw`\partial`,
  half: String.raw`\tfrac{1}{2}`, prime: String.raw`\prime`, nothing: '',
  times: String.raw`\times`, cdot: String.raw`\cdot`, del: String.raw`\nabla`,
  grad: String.raw`\nabla`, approx: String.raw`\approx`, cong: String.raw`\cong`,
  neq: String.raw`\neq`, '!=': String.raw`\neq`, '<=': String.raw`\leq`, '>=': String.raw`\geq`,
  '==': String.raw`\equiv`, '->': String.raw`\to`, '<-': String.raw`\gets`,
  sum: String.raw`\sum`, prod: String.raw`\prod`, int: String.raw`\int`,
  union: String.raw`\cup`, inter: String.raw`\cap`,
  lim: String.raw`\lim`, max: String.raw`\max`, min: String.raw`\min`,
  sin: String.raw`\sin`, cos: String.raw`\cos`, tan: String.raw`\tan`,
  log: String.raw`\log`, ln: String.raw`\ln`, exp: String.raw`\exp`,
  dot: '', dyad: '', vec: '', hat: '', bar: '', under: '', tilde: '',
}

/** Prefixy, které si berou jeden následující prvek. */
const DIACRITICS: Record<string, string> = {
  hat: String.raw`\hat`, bar: String.raw`\overline`, vec: String.raw`\vec`,
  dot: String.raw`\dot`, dotdot: String.raw`\ddot`, tilde: String.raw`\tilde`,
  under: String.raw`\underline`,
}

const SIZE_WORDS = new Set(['size', 'gsize', 'gfont', 'font'])
const FONT_WORDS: Record<string, string> = {
  bold: String.raw`\mathbf`,
  italic: String.raw`\mathit`,
  roman: String.raw`\mathrm`,
}

interface Parser {
  tokens: string[]
  index: number
  warnings: string[]
}

/** Rozdělit na prvky: závorky, řetězce v uvozovkách a slova mezi mezerami. */
function tokenize(source: string): string[] {
  const tokens: string[] = []
  let i = 0
  const text = source.replace(/\s+/g, ' ').trim()

  while (i < text.length) {
    const char = text[i]!
    if (char === ' ') {
      i += 1
      continue
    }
    if (char === '{' || char === '}') {
      tokens.push(char)
      i += 1
      continue
    }
    if (char === '"') {
      const end = text.indexOf('"', i + 1)
      const stop = end === -1 ? text.length : end
      tokens.push(`"${text.slice(i + 1, stop)}"`)
      i = stop + 1
      continue
    }
    let word = ''
    while (i < text.length && !' {}"'.includes(text[i]!)) {
      word += text[i]
      i += 1
    }
    tokens.push(word)
  }
  return tokens
}

const peek = (p: Parser): string | undefined => p.tokens[p.index]
const take = (p: Parser): string | undefined => p.tokens[p.index++]

/** Jeden prvek: skupina, řetězec, prefix, nebo obyčejné slovo. */
function parsePrimary(p: Parser): string {
  const token = take(p)
  if (token === undefined) return ''

  if (token === '{') {
    const inner = parseList(p, '}')
    if (peek(p) === '}') take(p)
    return `{${inner}}`
  }

  if (token.startsWith('"')) {
    const content = token.slice(1, -1)
    return content ? `\\text{${content}}` : ''
  }

  if (token === 'sqrt') {
    return `\\sqrt{${parsePrimary(p)}}`
  }

  if (DIACRITICS[token]) {
    return `${DIACRITICS[token]}{${parsePrimary(p)}}`
  }

  if (FONT_WORDS[token]) {
    return `${FONT_WORDS[token]}{${parsePrimary(p)}}`
  }

  // `size 12 x` -- velikost písma tady nemá smysl, přeskočí se i s číslem.
  if (SIZE_WORDS.has(token)) {
    take(p)
    return parsePrimary(p)
  }

  if (token === 'left' || token === 'right') {
    const delim = take(p) ?? ''
    const mapped = delim === 'nothing' ? '.' : delim === '{' ? String.raw`\{` : delim === '}' ? String.raw`\}` : delim
    return `\\${token}${mapped}`
  }

  if (token === 'matrix' || token === 'pile' || token === 'lpile' || token === 'cpile' || token === 'rpile') {
    p.warnings.push(`Konstrukci \`${token}\` zatím nepřekládám.`)
    // Obsah se přeskočí, aby z něj nevznikl nesmysl.
    if (peek(p) === '{') {
      take(p)
      parseList(p, '}')
      if (peek(p) === '}') take(p)
    }
    return ''
  }

  if (WORDS[token] !== undefined) return WORDS[token]!

  // Čísla a jednotlivá písmena projdou; delší slova se vysází jako text,
  // protože v eqn `abc` znamená tři proměnné, ne funkci.
  if (/^[0-9.]+$/.test(token)) return token
  if (/^[a-zA-Z]$/.test(token)) return token
  if (/^[a-zA-Z]+$/.test(token)) return `\\mathit{${token}}`
  return token
}

/** `sqrt`, indexy: váží těsněji než zlomek, doprava. */
function parseScripts(p: Parser): string {
  let base = parsePrimary(p)
  for (;;) {
    const next = peek(p)
    if (next === 'sup') {
      take(p)
      base = `${base}^{${parseScripts(p)}}`
    } else if (next === 'sub') {
      take(p)
      base = `${base}_{${parseScripts(p)}}`
    } else {
      return base
    }
  }
}

/** `a over b` -- zlomek. */
function parseFraction(p: Parser): string {
  const left = parseScripts(p)
  if (peek(p) === 'over') {
    take(p)
    return `\\frac{${left}}{${parseFraction(p)}}`
  }
  return left
}

/** `from` / `to` -- meze pod a nad. */
function parseLimits(p: Parser): string {
  let base = parseFraction(p)
  for (;;) {
    const next = peek(p)
    if (next === 'from') {
      take(p)
      base = `${base}_{${parseFraction(p)}}`
    } else if (next === 'to') {
      take(p)
      base = `${base}^{${parseFraction(p)}}`
    } else {
      return base
    }
  }
}

/** Posloupnost prvků až po `stop`. */
function parseList(p: Parser, stop?: string): string {
  const parts: string[] = []
  while (p.index < p.tokens.length && peek(p) !== stop) {
    const before = p.index
    const piece = parseLimits(p)
    if (p.index === before) {
      // Pojistka proti zacyklení na prvku, který nikdo nespotřeboval.
      take(p)
      continue
    }
    if (piece !== '') parts.push(piece)
  }
  return parts.join(' ')
}

export function fromEqn(source: string): MathConversion {
  const parser: Parser = { tokens: tokenize(source), index: 0, warnings: [] }
  // `delim $$` a spol. jsou nastavení preprocesoru, ne matematika.
  if (/^\s*delim\b/.test(source)) {
    return ok('', ['`delim` je nastavení eqn, ne vzorec.'])
  }
  const latex = parseList(parser)
  return ok(latex.trim(), parser.warnings)
}
