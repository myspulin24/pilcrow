/**
 * MathJSON -- výrazy jako JSON.
 *
 * Formát je stromový a dobře popsaný: `["Divide", 1, 2]` je zlomek, číslo je
 * číslo, řetězec je symbol. Díky tomu se dá přeložit poctivě a bez hádání --
 * na rozdíl od jazyků, kde se parsuje volný text.
 *
 * Pokrytý je standardní slovník; na funkci, kterou neznáme, se nevymýšlí
 * náhrada, ale vysází se jejím jménem a řekne se to nahlas.
 */

import { ok, type MathConversion } from './types'

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

/** Kolik „drží pohromadě" -- podle toho se doplňují závorky. */
const enum Prec {
  Lowest = 0,
  Relation = 1,
  Sum = 2,
  Product = 3,
  Power = 4,
  Atom = 5,
}

const GREEK: Record<string, string> = {
  Alpha: String.raw`\alpha`, Beta: String.raw`\beta`, Gamma: String.raw`\gamma`,
  Delta: String.raw`\delta`, Epsilon: String.raw`\epsilon`, Theta: String.raw`\theta`,
  Lambda: String.raw`\lambda`, Mu: String.raw`\mu`, Pi: String.raw`\pi`,
  Sigma: String.raw`\sigma`, Phi: String.raw`\phi`, Omega: String.raw`\omega`,
}

const CONSTANTS: Record<string, string> = {
  Pi: String.raw`\pi`,
  ExponentialE: String.raw`\mathrm{e}`,
  ImaginaryUnit: String.raw`\mathrm{i}`,
  PositiveInfinity: String.raw`\infty`,
  NegativeInfinity: String.raw`-\infty`,
  ComplexInfinity: String.raw`\tilde\infty`,
  Nothing: '',
  True: String.raw`\mathrm{True}`,
  False: String.raw`\mathrm{False}`,
}

const RELATIONS: Record<string, string> = {
  Equal: '=', NotEqual: String.raw`\neq`, Less: '<', LessEqual: String.raw`\leq`,
  Greater: '>', GreaterEqual: String.raw`\geq`, Element: String.raw`\in`,
  NotElement: String.raw`\notin`, Subset: String.raw`\subset`,
  SubsetEqual: String.raw`\subseteq`, Approx: String.raw`\approx`,
}

const NAMED_FUNCTIONS = new Set([
  'Sin', 'Cos', 'Tan', 'Cot', 'Sec', 'Csc', 'Arcsin', 'Arccos', 'Arctan',
  'Sinh', 'Cosh', 'Tanh', 'Ln', 'Log', 'Exp', 'Max', 'Min', 'Gcd', 'Lcm',
])

interface Context {
  warnings: string[]
}

/** Obalit závorkami, jen když je to potřeba. */
const wrap = (latex: string, actual: Prec, needed: Prec): string =>
  actual < needed ? `\\left(${latex}\\right)` : latex

function symbol(name: string, context: Context): string {
  if (CONSTANTS[name] !== undefined) return CONSTANTS[name]!
  if (GREEK[name]) return GREEK[name]!
  if (name.length === 1) return name
  // Víc písmen je jméno, ne součin proměnných.
  void context
  return `\\mathrm{${name}}`
}

function convert(node: Json, context: Context): { latex: string; prec: Prec } {
  if (node === null) return { latex: '', prec: Prec.Atom }
  if (typeof node === 'number') {
    return { latex: String(node), prec: node < 0 ? Prec.Sum : Prec.Atom }
  }
  if (typeof node === 'boolean') {
    return { latex: node ? String.raw`\mathrm{True}` : String.raw`\mathrm{False}`, prec: Prec.Atom }
  }
  if (typeof node === 'string') {
    return { latex: symbol(node, context), prec: Prec.Atom }
  }

  // `{ num: "3.14" }`, `{ sym: "x" }`, `{ str: "text" }`
  if (!Array.isArray(node)) {
    if (typeof node.num === 'string' || typeof node.num === 'number') {
      return { latex: String(node.num), prec: Prec.Atom }
    }
    if (typeof node.sym === 'string') {
      return { latex: symbol(node.sym, context), prec: Prec.Atom }
    }
    if (typeof node.str === 'string') {
      return { latex: `\\text{${node.str}}`, prec: Prec.Atom }
    }
    if (node.fn !== undefined) return convert(node.fn as Json, context)
    context.warnings.push('Objekt bez `num`, `sym`, `str` ani `fn` neumím přečíst.')
    return { latex: '', prec: Prec.Atom }
  }

  const [head, ...args] = node
  if (typeof head !== 'string') {
    context.warnings.push('Výraz musí začínat jménem funkce.')
    return { latex: '', prec: Prec.Atom }
  }

  const at = (index: number, needed: Prec): string => {
    const arg = args[index]
    if (arg === undefined) return ''
    const { latex, prec } = convert(arg, context)
    return wrap(latex, prec, needed)
  }

  switch (head) {
    case 'Add': {
      const parts = args.map((arg) => {
        const { latex, prec } = convert(arg, context)
        return wrap(latex, prec, Prec.Sum)
      })
      // `a + -b` se čte hůř než `a - b`.
      const joined = parts.reduce((acc, part, i) =>
        i === 0 ? part : part.startsWith('-') ? `${acc} - ${part.slice(1)}` : `${acc} + ${part}`,
      '')
      return { latex: joined, prec: Prec.Sum }
    }
    case 'Subtract':
      return { latex: `${at(0, Prec.Sum)} - ${at(1, Prec.Product)}`, prec: Prec.Sum }
    case 'Negate':
      return { latex: `-${at(0, Prec.Product)}`, prec: Prec.Sum }
    case 'Multiply': {
      const parts = args.map((arg) => {
        const { latex, prec } = convert(arg, context)
        return wrap(latex, prec, Prec.Product)
      })
      return { latex: parts.join(String.raw` \cdot `), prec: Prec.Product }
    }
    case 'Divide':
    case 'Rational':
      return { latex: `\\frac{${at(0, Prec.Lowest)}}{${at(1, Prec.Lowest)}}`, prec: Prec.Atom }
    case 'Power':
      return { latex: `${at(0, Prec.Power)}^{${at(1, Prec.Lowest)}}`, prec: Prec.Power }
    case 'Root':
      return { latex: `\\sqrt[${at(1, Prec.Lowest)}]{${at(0, Prec.Lowest)}}`, prec: Prec.Atom }
    case 'Sqrt':
      return { latex: `\\sqrt{${at(0, Prec.Lowest)}}`, prec: Prec.Atom }
    case 'Abs':
      return { latex: `\\left|${at(0, Prec.Lowest)}\\right|`, prec: Prec.Atom }
    case 'Floor':
      return { latex: `\\lfloor ${at(0, Prec.Lowest)} \\rfloor`, prec: Prec.Atom }
    case 'Ceil':
      return { latex: `\\lceil ${at(0, Prec.Lowest)} \\rceil`, prec: Prec.Atom }
    case 'Delimiter':
      return { latex: `\\left(${at(0, Prec.Lowest)}\\right)`, prec: Prec.Atom }
    case 'Sum':
    case 'Product': {
      const operator = head === 'Sum' ? String.raw`\sum` : String.raw`\prod`
      const body = at(0, Prec.Product)
      const range = args[1]
      if (Array.isArray(range) && range[0] === 'Triple') {
        const variable = convert(range[1] as Json, context).latex
        const from = convert(range[2] as Json, context).latex
        const to = convert(range[3] as Json, context).latex
        return { latex: `${operator}_{${variable}=${from}}^{${to}} ${body}`, prec: Prec.Product }
      }
      return { latex: `${operator} ${body}`, prec: Prec.Product }
    }
    case 'Integrate': {
      const body = at(0, Prec.Product)
      const range = args[1]
      if (Array.isArray(range) && range[0] === 'Triple') {
        const variable = convert(range[1] as Json, context).latex
        const from = convert(range[2] as Json, context).latex
        const to = convert(range[3] as Json, context).latex
        return {
          latex: `\\int_{${from}}^{${to}} ${body} \\, \\mathrm{d}${variable}`,
          prec: Prec.Product,
        }
      }
      return { latex: `\\int ${body}`, prec: Prec.Product }
    }
    case 'List':
      return {
        latex: `\\left[${args.map((_, i) => at(i, Prec.Lowest)).join(', ')}\\right]`,
        prec: Prec.Atom,
      }
    case 'Set':
      return {
        latex: `\\left\\{${args.map((_, i) => at(i, Prec.Lowest)).join(', ')}\\right\\}`,
        prec: Prec.Atom,
      }
    default: {
      if (RELATIONS[head]) {
        return {
          latex: `${at(0, Prec.Relation)} ${RELATIONS[head]} ${at(1, Prec.Relation)}`,
          prec: Prec.Relation,
        }
      }
      if (NAMED_FUNCTIONS.has(head)) {
        const name = head.toLowerCase()
        const known = ['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'sinh', 'cosh', 'tanh', 'ln', 'log', 'exp', 'max', 'min']
        const command = known.includes(name) ? `\\${name}` : `\\operatorname{${name}}`
        return { latex: `${command}\\left(${at(0, Prec.Lowest)}\\right)`, prec: Prec.Atom }
      }
      context.warnings.push(`Funkci \`${head}\` neznám, vysázím ji jménem.`)
      const inner = args.map((_, i) => at(i, Prec.Lowest)).join(', ')
      return { latex: `\\operatorname{${head}}\\left(${inner}\\right)`, prec: Prec.Atom }
    }
  }
}

export function fromMathJson(source: string): MathConversion {
  const text = source.trim()
  if (!text) return ok('')

  let parsed: Json
  try {
    parsed = JSON.parse(text) as Json
  } catch (error) {
    return ok('', [`Tohle není platný JSON. ${error instanceof Error ? error.message : ''}`.trim()])
  }

  const context: Context = { warnings: [] }
  const { latex } = convert(parsed, context)
  return ok(latex.trim(), context.warnings)
}
