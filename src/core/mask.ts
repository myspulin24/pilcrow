/**
 * Code masking.
 *
 * Tags and wiki links must not be picked up from fenced code blocks, indented
 * code blocks or inline code spans -- otherwise a shell snippet containing
 * `#!/bin/sh` invents a `#!` tag, and a Rust snippet containing `Vec<[[T]]>`
 * invents a backlink.
 *
 * `maskCode` returns a string of the *same length* as the input, with every
 * masked character replaced by a space. Offsets therefore stay valid against
 * the original text, so callers can scan the mask and slice the original.
 */
export function maskCode(body: string): string {
  const source = body.replace(/\r\n/g, '\n')
  const out = source.split('')

  const blank = (start: number, end: number) => {
    for (let i = start; i < end && i < out.length; i++) {
      if (out[i] !== '\n') out[i] = ' '
    }
  }

  // 1. Fenced code blocks (``` or ~~~), including unterminated ones.
  const fence = /^([ \t]{0,3})(`{3,}|~{3,})[^\n]*$/gm
  let match: RegExpExecArray | null
  const fences: Array<{ index: number; end: number; marker: string; indent: number }> = []
  while ((match = fence.exec(source)) !== null) {
    fences.push({
      index: match.index,
      end: match.index + match[0].length,
      marker: (match[2] ?? '').charAt(0),
      indent: (match[1] ?? '').length,
    })
  }
  let i = 0
  const closedRanges: Array<[number, number]> = []
  while (i < fences.length) {
    const open = fences[i]!
    let close: (typeof fences)[number] | undefined
    for (let j = i + 1; j < fences.length; j++) {
      if (fences[j]!.marker === open.marker) {
        close = fences[j]
        i = j + 1
        break
      }
    }
    if (close) {
      blank(open.index, close.end)
      closedRanges.push([open.index, close.end])
    } else {
      blank(open.index, source.length)
      closedRanges.push([open.index, source.length])
      i = fences.length
      break
    }
  }
  const inFence = (index: number) => closedRanges.some(([s, e]) => index >= s && index < e)

  // 2. Indented (4-space) code blocks, but only when they follow a blank line.
  const lines = source.split('\n')
  let offset = 0
  let previousBlank = true
  for (const line of lines) {
    const isIndented = /^(\t| {4})/.test(line) && line.trim() !== ''
    if (isIndented && previousBlank && !inFence(offset)) {
      blank(offset, offset + line.length)
    }
    if (line.trim() !== '') previousBlank = isIndented
    else previousBlank = true
    offset += line.length + 1
  }

  // 3. Inline code spans, longest-run-first so ``a ` b`` behaves.
  const inline = /(`+)([^\n]*?)\1/g
  while ((match = inline.exec(source)) !== null) {
    if (inFence(match.index)) continue
    blank(match.index, match.index + match[0].length)
  }

  // 4. Autolinks and inline-link destinations, so `](https://x/#frag)` and bare
  //    URLs never produce tags.
  const urls = /(?:\]\(\s*<?)([^)\s]+)|<(https?:\/\/[^>\s]+)>|(?:^|\s)(https?:\/\/\S+)/g
  while ((match = urls.exec(source)) !== null) {
    if (inFence(match.index)) continue
    blank(match.index, match.index + match[0].length)
  }

  return out.join('')
}
