/**
 * Obsahové MathML.
 *
 * Na rozdíl od prezentačního nepopisuje, jak vzorec vypadá, ale co znamená:
 * `<apply><divide/><ci>a</ci><ci>b</ci></apply>` je „poděl a b". Prohlížeč to
 * nevykreslí a knihovna na prezentační MathML si s tím neporadí, takže se
 * překládá tady.
 *
 * Je to předponový strom, tedy stejná úloha jako u MathJSON -- proto stejný
 * postup: projít strom a poskládat LaTeX, u neznámého operátoru nevymýšlet
 * náhradu, ale říct to nahlas.
 *
 * XML se parsuje vlastním malým čtečem místo `DOMParser`, aby jádro zůstalo
 * nezávislé na prohlížeči. Obsahové MathML má jednoduchou strukturu, takže to
 * stojí pár desítek řádků.
 */

import { ok, type MathConversion } from './types'

interface Node {
  tag: string
  attributes: Record<string, string>
  children: Node[]
  text: string
}

/** Malý čteč XML. Umí prvky, atributy a text -- víc obsahové MathML nemá. */
function parseXml(source: string): Node | null {
  const text = source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .trim()

  const stack: Node[] = []
  let root: Node | null = null
  const TOKEN = /<\s*(\/?)([a-zA-Z][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>])*?)(\/?)\s*>|([^<]+)/g

  for (const match of text.matchAll(TOKEN)) {
    const [, closing, rawTag, rawAttributes, selfClosing, chars] = match

    if (chars !== undefined) {
      const content = chars.trim()
      if (content && stack.length > 0) stack[stack.length - 1]!.text += content
      continue
    }
    if (rawTag === undefined) continue

    // Předpony jmenných prostorů (`m:apply`) zahodit.
    const tag = rawTag.includes(':') ? rawTag.slice(rawTag.indexOf(':') + 1) : rawTag

    if (closing) {
      const done = stack.pop()
      if (stack.length === 0 && done) root = done
      continue
    }

    const attributes: Record<string, string> = {}
    for (const attr of (rawAttributes ?? '').matchAll(/([a-zA-Z][\w:.-]*)\s*=\s*"([^"]*)"|([a-zA-Z][\w:.-]*)\s*=\s*'([^']*)'/g)) {
      const name = attr[1] ?? attr[3]
      const value = attr[2] ?? attr[4]
      if (name) attributes[name.toLowerCase()] = value ?? ''
    }

    const node: Node = { tag, attributes, children: [], text: '' }
    if (stack.length > 0) stack[stack.length - 1]!.children.push(node)
    if (selfClosing) {
      if (stack.length === 0) root = node
    } else {
      stack.push(node)
    }
  }

  // Nedovřené prvky: vzít, co se stihlo poskládat.
  if (!root && stack.length > 0) root = stack[0]!
  return root
}

/** Binární a n-ární operátory, které se skládají mezi argumenty. */
const INFIX: Record<string, string> = {
  plus: ' + ',
  minus: ' - ',
  times: String.raw` \cdot `,
  eq: ' = ',
  neq: String.raw` \neq `,
  lt: ' < ',
  gt: ' > ',
  leq: String.raw` \leq `,
  geq: String.raw` \geq `,
  in: String.raw` \in `,
  notin: String.raw` \notin `,
  subset: String.raw` \subset `,
  union: String.raw` \cup `,
  intersect: String.raw` \cap `,
  and: String.raw` \land `,
  or: String.raw` \lor `,
  implies: String.raw` \Rightarrow `,
  equivalent: String.raw` \equiv `,
  approx: String.raw` \approx `,
}

/** Funkce, které se píší jménem před závorkou. */
const FUNCTIONS: Record<string, string> = {
  sin: String.raw`\sin`, cos: String.raw`\cos`, tan: String.raw`\tan`,
  cot: String.raw`\cot`, sec: String.raw`\sec`, csc: String.raw`\csc`,
  arcsin: String.raw`\arcsin`, arccos: String.raw`\arccos`, arctan: String.raw`\arctan`,
  sinh: String.raw`\sinh`, cosh: String.raw`\cosh`, tanh: String.raw`\tanh`,
  ln: String.raw`\ln`, log: String.raw`\log`, exp: String.raw`\exp`,
  max: String.raw`\max`, min: String.raw`\min`, gcd: String.raw`\gcd`, det: String.raw`\det`,
}

const CONSTANTS: Record<string, string> = {
  pi: String.raw`\pi`,
  exponentiale: String.raw`\mathrm{e}`,
  imaginaryi: String.raw`\mathrm{i}`,
  infinity: String.raw`\infty`,
  emptyset: String.raw`\emptyset`,
  true: String.raw`\mathrm{true}`,
  false: String.raw`\mathrm{false}`,
  naturalnumbers: String.raw`\mathbb{N}`,
  integers: String.raw`\mathbb{Z}`,
  rationals: String.raw`\mathbb{Q}`,
  reals: String.raw`\mathbb{R}`,
  complexes: String.raw`\mathbb{C}`,
}

interface Context {
  warnings: string[]
}

/** Prvky, které nenesou hodnotu, jen doprovodné údaje. */
const SIDE_ELEMENTS = new Set(['bvar', 'lowlimit', 'uplimit', 'degree', 'condition', 'domainofapplication'])

function child(node: Node, tag: string): Node | undefined {
  return node.children.find((c) => c.tag === tag)
}

function convert(node: Node, context: Context): string {
  switch (node.tag) {
    case 'math':
    case 'semantics':
    case 'mrow': {
      const parts = node.children.filter((c) => c.tag !== 'annotation' && c.tag !== 'annotation-xml')
      return parts.map((c) => convert(c, context)).filter(Boolean).join(' ')
    }
    case 'ci': {
      const name = node.text.trim()
      return name.length === 1 ? name : `\\mathrm{${name}}`
    }
    case 'cn': {
      const value = node.text.trim()
      // `<cn type="rational">1<sep/>2</cn>`
      if (node.attributes.type === 'rational' && node.children.some((c) => c.tag === 'sep')) {
        const [a, b] = value.split(/\s+/)
        return `\\frac{${a ?? ''}}{${b ?? ''}}`
      }
      return value
    }
    case 'csymbol':
      return `\\mathrm{${node.text.trim()}}`
    case 'apply':
      return convertApply(node, context)
    case 'matrix':
      return `\\begin{pmatrix}${node.children.map((r) => convert(r, context)).join(String.raw` \\ `)}\\end{pmatrix}`
    case 'matrixrow':
      return node.children.map((c) => convert(c, context)).join(' & ')
    case 'set':
      return `\\left\\{${node.children.map((c) => convert(c, context)).join(', ')}\\right\\}`
    case 'list':
      return `\\left[${node.children.map((c) => convert(c, context)).join(', ')}\\right]`
    case 'piecewise':
      return `\\begin{cases}${node.children.map((c) => convert(c, context)).join(String.raw` \\ `)}\\end{cases}`
    case 'piece': {
      const [value, condition] = node.children
      return `${value ? convert(value, context) : ''} & ${condition ? convert(condition, context) : ''}`
    }
    case 'otherwise':
      return `${node.children.map((c) => convert(c, context)).join(' ')} & \\text{jinak}`
    case 'sep':
      return ' '
    default: {
      if (CONSTANTS[node.tag]) return CONSTANTS[node.tag]!
      if (node.children.length > 0) {
        return node.children.map((c) => convert(c, context)).filter(Boolean).join(' ')
      }
      return node.text.trim()
    }
  }
}

function convertApply(node: Node, context: Context): string {
  const [operator, ...rest] = node.children
  if (!operator) return ''

  const args = rest.filter((c) => !SIDE_ELEMENTS.has(c.tag))
  const value = (index: number) => {
    const arg = args[index]
    return arg ? convert(arg, context) : ''
  }
  const all = () => args.map((a) => convert(a, context))

  const tag = operator.tag

  switch (tag) {
    case 'divide':
      return `\\frac{${value(0)}}{${value(1)}}`
    case 'power':
      return `${value(0)}^{${value(1)}}`
    case 'root': {
      const degree = child(node, 'degree')
      const index = degree ? convert(degree, context) : ''
      return index && index !== '2' ? `\\sqrt[${index}]{${value(0)}}` : `\\sqrt{${value(0)}}`
    }
    case 'minus':
      // Jednoargumentové `minus` je znaménko, ne rozdíl.
      return args.length === 1 ? `-${value(0)}` : all().join(' - ')
    case 'abs':
      return `\\left|${value(0)}\\right|`
    case 'floor':
      return `\\lfloor ${value(0)} \\rfloor`
    case 'ceiling':
      return `\\lceil ${value(0)} \\rceil`
    case 'factorial':
      return `${value(0)}!`
    case 'sum':
    case 'product': {
      const symbol = tag === 'sum' ? String.raw`\sum` : String.raw`\prod`
      const bvar = child(node, 'bvar')
      const low = child(node, 'lowlimit')
      const up = child(node, 'uplimit')
      const variable = bvar ? convert(bvar, context) : ''
      const from = low ? convert(low, context) : ''
      const to = up ? convert(up, context) : ''
      const bounds =
        variable && from ? `_{${variable}=${from}}` : from ? `_{${from}}` : ''
      return `${symbol}${bounds}${to ? `^{${to}}` : ''} ${value(0)}`.trim()
    }
    case 'int': {
      const bvar = child(node, 'bvar')
      const low = child(node, 'lowlimit')
      const up = child(node, 'uplimit')
      const variable = bvar ? convert(bvar, context) : 'x'
      const from = low ? convert(low, context) : ''
      const to = up ? convert(up, context) : ''
      const bounds = from ? `_{${from}}` : ''
      return `\\int${bounds}${to ? `^{${to}}` : ''} ${value(0)} \\, \\mathrm{d}${variable}`.trim()
    }
    case 'limit': {
      const bvar = child(node, 'bvar')
      const condition = child(node, 'condition')
      const variable = bvar ? convert(bvar, context) : ''
      const target = condition ? convert(condition, context) : ''
      return `\\lim_{${variable}${target ? ` \\to ${target}` : ''}} ${value(0)}`
    }
    case 'diff': {
      const bvar = child(node, 'bvar')
      const variable = bvar ? convert(bvar, context) : 'x'
      return `\\frac{\\mathrm{d}}{\\mathrm{d}${variable}} ${value(0)}`
    }
    case 'partialdiff': {
      const bvar = child(node, 'bvar')
      const variable = bvar ? convert(bvar, context) : 'x'
      return `\\frac{\\partial}{\\partial ${variable}} ${value(0)}`
    }
    case 'not':
      return `\\lnot ${value(0)}`
    default: {
      if (INFIX[tag]) return all().join(INFIX[tag]!)
      if (FUNCTIONS[tag]) return `${FUNCTIONS[tag]}\\left(${all().join(', ')}\\right)`
      if (tag === 'ci' || tag === 'csymbol') {
        // Aplikace uživatelské funkce: `<apply><ci>f</ci><ci>x</ci></apply>`
        return `${convert(operator, context)}\\left(${all().join(', ')}\\right)`
      }
      context.warnings.push(`Operátor \`${tag}\` neznám, vysázím ho jménem.`)
      return `\\operatorname{${tag}}\\left(${all().join(', ')}\\right)`
    }
  }
}

export function fromContentMathml(source: string): MathConversion {
  const text = source.trim()
  if (!text) return ok('')

  const root = parseXml(text)
  if (!root) return ok('', ['Tohle se nepodařilo přečíst jako XML.'])

  const context: Context = { warnings: [] }
  const latex = convert(root, context).trim()
  if (!latex) {
    return ok('', ['Z tohohle obsahového MathML se nepodařilo nic vysázet.'])
  }
  return ok(latex, context.warnings)
}
