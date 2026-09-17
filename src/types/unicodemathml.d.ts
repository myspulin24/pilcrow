/**
 * `unicodemathml` nemá vlastní typy.
 *
 * Deklaruje se tu jen to, co opravdu voláme, ne celá knihovna -- kdyby se
 * přidalo víc, muselo by se to udržovat, a udržovat cizí typy naslepo je
 * horší než je nemít.
 */
declare module 'unicodemathml' {
  /** Vrací hotové MathML jako řetězec, nebo objekt s polem `mathml`. */
  export function convertUnicodeMathToMathML(source: string): string | { mathml?: string }
}
