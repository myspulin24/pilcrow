/**
 * Wolfram Language.
 *
 * Vyhodnotit výraz umí jen Mathematica, ale o to tu nejde -- vzorec se má
 * vysázet, ne spočítat. Wolfram má dvě podoby zápisu a obě se sem vejdou:
 *
 *   - funkční:  `Power[x, 2]`, `Sqrt[y]`, `Integrate[f, {x, 0, 1}]`
 *   - infixová: `x^2 + Sqrt[y]`, `a/b`, `x == 1`
 *
 * Překládá se rekurzivním sestupem přes obvyklé priority. Funkci, kterou
 * neznáme, nevymýšlíme -- vysází se jménem a řekne se to.
 */

import { ok, type MathConversion } from './types'

interface Parser {
  text: string
  index: number
  warnings: string[]
}

const SYMBOLS: Record<string, string> = {
  Pi: String.raw`\pi`, E: String.raw`\mathrm{e}`, I: String.raw`\mathrm{i}`,
  Infinity: String.raw`\infty`, Degree: String.raw`^\circ`,
  Alpha: String.raw`\alpha`, Beta: String.raw`\beta`, Gamma: String.raw`\Gamma`,
  Delta: String.raw`\Delta`, Epsilon: String.raw`\epsilon`, Theta: String.raw`\theta`,
  Lambda: String.raw`\lambda`, Mu: String.raw`\mu`, Sigma: String.raw`\sigma`,
  Phi: String.raw`\phi`, Omega: String.raw`\Omega`,
}

const FUNCTIONS: Record<string, string> = {
  Sin: String.raw`\sin`, Cos: String.raw`\cos`, Tan: String.raw`\tan`,
  Cot: String.raw`\cot`, Sec: String.raw`\sec`, Csc: String.raw`\csc`,
  ArcSin: String.raw`\arcsin`, ArcCos: String.raw`\arccos`, ArcTan: String.raw`\arctan`,
  Sinh: String.raw`\sinh`, Cosh: String.raw`\cosh`, Tanh: String.raw`\tanh`,
  Log: String.raw`\ln`, Exp: String.raw`\exp`, Max: String.raw`\max`, Min: String.raw`\min`,
  Det: String.raw`\det`, Dim: String.raw`\dim`,
}

const skip = (p: Parser) => {
  while (p.index < p.text.length && /\s/.test(p.text[p.index]!)) p.index += 1
}

const at = (p: Parser, text: string): boolean => {
  skip(p)
  return p.text.startsWith(text, p.index)
}

const eat = (p: Parser, text: string): boolean => {
  if (!at(p, text)) return false
  p.index += text.length
  return true
}

/** Seznam argumentů v `[...]` nebo `{...}`. */
function parseArgs(p: Parser, close: string): string[] {
  const args: string[] = []
  skip(p)
  if (at(p, close)) {
    p.index += close.length
    return args
  }
  for (;;) {
    args.push(parseExpression(p))
    skip(p)
    if (eat(p, ',')) continue
    if (eat(p, close)) break
    // Nedopsaný výraz: radši skončit, než se zacyklit.
    break
  }
  return args
}

function applyFunction(name: string, args: string[], p: Parser): string {
  const a = (i: number) => args[i] ?? ''
  switch (name) {
    case 'Sqrt':
      return `\\sqrt{${a(0)}}`
    case 'Power':
      return `${a(0)}^{${a(1)}}`
    case 'Divide':
    case 'Rational':
      return `\\frac{${a(0)}}{${a(1)}}`
    case 'Times':
      return args.join(String.raw` \cdot `)
    case 'Plus':
      return args.join(' + ')
    case 'Subtract':
      return `${a(0)} - ${a(1)}`
    case 'Minus':
      return `-${a(0)}`
    case 'Abs':
      return `\\left|${a(0)}\\right|`
    case 'Floor':
      return `\\lfloor ${a(0)} \\rfloor`
    case 'Ceiling':
      return `\\lceil ${a(0)} \\rceil`
    case 'Sum':
    case 'Product': {
      const operator = name === 'Sum' ? String.raw`\sum` : String.raw`\prod`
      // Druhý argument je `{i, 1, n}`, který parser vrátil jako `i, 1, n`.
      const range = (a(1) || '').split(',').map((s) => s.trim())
      if (range.length >= 3) {
        return `${operator}_{${range[0]}=${range[1]}}^{${range[2]}} ${a(0)}`
      }
      return `${operator} ${a(0)}`
    }
    case 'Integrate': {
      const range = (a(1) || '').split(',').map((s) => s.trim())
      if (range.length >= 3) {
        return `\\int_{${range[1]}}^{${range[2]}} ${a(0)} \\, \\mathrm{d}${range[0]}`
      }
      return `\\int ${a(0)} \\, \\mathrm{d}${range[0] ?? 'x'}`
    }
    case 'Limit':
      return `\\lim ${a(0)}`
    case 'D':
      return `\\frac{\\partial}{\\partial ${a(1)}} ${a(0)}`
    case 'Sqrt2':
      return `\\sqrt{2}`
    case 'List':
      return `\\left\\{${args.join(', ')}\\right\\}`
    default: {
      if (FUNCTIONS[name]) return `${FUNCTIONS[name]}\\left(${a(0)}\\right)`
      p.warnings.push(`Funkci \`${name}\` neznám, vysázím ji jménem.`)
      return `\\operatorname{${name}}\\left(${args.join(', ')}\\right)`
    }
  }
}

function parsePrimary(p: Parser): string {
  skip(p)
  if (p.index >= p.text.length) return ''

  if (eat(p, '(')) {
    const inner = parseExpression(p)
    eat(p, ')')
    return `\\left(${inner}\\right)`
  }

  if (eat(p, '{')) {
    // Seznam. Uvnitř `Sum`/`Integrate` je to rozsah, jinak množina.
    const args = parseArgs(p, '}')
    return args.join(', ')
  }

  if (eat(p, '-')) return `-${parsePrimary(p)}`
  if (eat(p, '+')) return parsePrimary(p)

  const number = /^\d+(?:\.\d+)?/.exec(p.text.slice(p.index))
  if (number) {
    p.index += number[0].length
    return number[0]
  }

  const name = /^[A-Za-z][A-Za-z0-9]*/.exec(p.text.slice(p.index))
  if (name) {
    p.index += name[0].length
    const identifier = name[0]
    skip(p)
    if (eat(p, '[')) {
      const args = parseArgs(p, ']')
      return applyFunction(identifier, args, p)
    }
    if (SYMBOLS[identifier]) return SYMBOLS[identifier]!
    if (identifier.length === 1) return identifier
    return `\\mathrm{${identifier}}`
  }

  // Neznámý znak: spotřebovat, ať se parser nezasekne.
  const char = p.text[p.index]!
  p.index += 1
  return char
}

function parsePower(p: Parser): string {
  const base = parsePrimary(p)
  if (eat(p, '^')) {
    return `${base}^{${parsePower(p)}}`
  }
  return base
}

function parseProduct(p: Parser): string {
  let left = parsePower(p)
  for (;;) {
    skip(p)
    if (eat(p, '/')) {
      left = `\\frac{${left}}{${parsePower(p)}}`
    } else if (eat(p, '*')) {
      left = `${left} \\cdot ${parsePower(p)}`
    } else {
      return left
    }
  }
}

function parseSum(p: Parser): string {
  let left = parseProduct(p)
  for (;;) {
    skip(p)
    // `-` musí zůstat na následujícím prvku, když je to znaménko, ne rozdíl.
    if (p.text.startsWith('+', p.index)) {
      p.index += 1
      left = `${left} + ${parseProduct(p)}`
    } else if (p.text.startsWith('-', p.index)) {
      p.index += 1
      left = `${left} - ${parseProduct(p)}`
    } else {
      return left
    }
  }
}

const RELATIONS: Array<[string, string]> = [
  ['==', '='], ['!=', String.raw`\neq`], ['<=', String.raw`\leq`], ['>=', String.raw`\geq`],
  ['->', String.raw`\to`], ['<', '<'], ['>', '>'], ['=', '='],
]

function parseExpression(p: Parser): string {
  let left = parseSum(p)
  for (;;) {
    skip(p)
    const relation = RELATIONS.find(([token]) => p.text.startsWith(token, p.index))
    if (!relation) return left
    p.index += relation[0].length
    left = `${left} ${relation[1]} ${parseSum(p)}`
  }
}

export function fromWolfram(source: string): MathConversion {
  const parser: Parser = { text: source.trim(), index: 0, warnings: [] }
  if (!parser.text) return ok('')
  const latex = parseExpression(parser)
  return ok(latex.trim(), parser.warnings)
}
