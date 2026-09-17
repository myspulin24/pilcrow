/**
 * Společný tvar všech převodníků vzorců.
 *
 * Každý jazyk má vlastní syntax, ale všechny končí na stejném místě: v LaTeXu,
 * který vysází KaTeX, nebo v MathML, které vykreslí samo WebView. Díky tomu je
 * v aplikaci jeden sázeč, ne třináct.
 *
 * `warnings` je tu proto, že u některých jazyků je převod jen nejlepší možný.
 * Když se něco nerozpozná, musí to být vidět -- nikdy se nesmí vysázet něco
 * jiného, než co uživatel napsal, a tvářit se, že je to v pořádku.
 */

export interface MathConversion {
  /** LaTeX pro KaTeX. Prázdný, když jazyk vede přes MathML. */
  latex: string
  /** Hotové MathML, když jazyk končí tudy. */
  mathml?: string
  /** Konstrukce, které se nepodařilo přeložit. */
  warnings: string[]
}

export type MathConverter = (source: string) => MathConversion

export const ok = (latex: string, warnings: string[] = []): MathConversion => ({ latex, warnings })

export const viaMathml = (mathml: string, warnings: string[] = []): MathConversion => ({
  latex: '',
  mathml,
  warnings,
})
