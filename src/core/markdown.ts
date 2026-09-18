/**
 * A small, dependency-free Markdown renderer.
 *
 * It exists instead of a general-purpose library because Pilcrow needs three
 * things a stock renderer does not give us:
 *
 *   1. `[[wiki links]]` rendered as real links that know whether the target
 *      exists (unresolved links get a different colour, like Bear's).
 *   2. `#tags` rendered as clickable filters.
 *   3. Local image attachments rewritten through a host-provided resolver,
 *      because a webview cannot load `file://` paths directly.
 *
 * Everything is HTML-escaped at the source, and every URL is scheme-checked,
 * so the output is safe to hand to `dangerouslySetInnerHTML`.
 */

import { parseLinkTarget } from './wikilinks'
import { normalizeTag } from './tags'
import { renderMath, renderMathIn } from './math'
import { mathLanguageByAlias } from './math-languages'
import { t } from './messages'

export interface RenderOptions {
  /** Resolve a `[[target]]` to an href and whether the note exists. */
  resolveWikiLink?: (target: string) => { href: string; exists: boolean }
  /** Rewrite a relative image path into something the webview can load. */
  resolveImage?: (src: string) => string
  /** Render task checkboxes as enabled inputs (the preview pane does). */
  interactiveTasks?: boolean
}

const SAFE_URL = /^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i

/** Escape text for insertion into HTML element content or an attribute. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Allow only schemes that cannot execute script. */
export function sanitizeUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''
  if (SAFE_URL.test(trimmed)) return trimmed
  // Anything with no scheme at all is a relative path, which is fine.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed
  return ''
}

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i

export function isLocalImagePath(src: string): boolean {
  return !/^[a-z][a-z0-9+.-]*:/i.test(src) && IMAGE_EXTENSIONS.test(src.split(/[?#]/)[0] ?? '')
}

interface InlineContext {
  options: RenderOptions
  placeholders: string[]
}

const PLACEHOLDER_START = '\u0000'
const PLACEHOLDER_END = '\u0001'

function stash(context: InlineContext, html: string): string {
  context.placeholders.push(html)
  return `${PLACEHOLDER_START}${context.placeholders.length - 1}${PLACEHOLDER_END}`
}

function restore(context: InlineContext, text: string): string {
  return text.replace(/\u0000(\d+)\u0001/g, (_full, index: string) => {
    const value = context.placeholders[Number(index)]
    return value === undefined ? '' : value
  })
}

/** Render inline Markdown (everything inside a single block). */
export function renderInline(source: string, options: RenderOptions = {}): string {
  const context: InlineContext = { options, placeholders: [] }
  // Strip the placeholder sentinels so user text can never forge one.
  let text = source.replace(/[\u0000\u0001]/g, '')

  // Code and formulas come out of the text before anything else, in one
  // left-to-right pass.
  //
  // Both are verbatim: what is inside them must reach `<code>` or KaTeX
  // exactly as it was typed. Running them as separate passes, or after the
  // backslash-escape pass, quietly corrupts them:
  //
  //   - `\{` and `\}` are Markdown escapes *and* LaTeX set braces. With
  //     escapes first, `$c\in\{1,2\}$` reached KaTeX as placeholder sentinels
  //     instead of braces.
  //   - A single scan keeps document order, so the `$` in `` `$x$` `` stays
  //     code and a backtick inside `$...$` stays part of the formula.
  //
  // Escaped delimiters still work: `` \` `` is not code because the opening
  // backtick is preceded by a backslash, and `\$5` is not a formula because
  // the opening `$` may not follow one.
  const VERBATIM = new RegExp(
    [
      // 1: lead, 2: ticks, 3: code
      String.raw`(^|[^\\])(\x60+)([^\n]*?)\2`,
      // 4: display formula written inside a line
      String.raw`\$\$([^\n]+?)\$\$`,
      // 5: lead, 6: inline formula
      String.raw`(^|[^\d\\$])\$(?!\s)((?:[^$\n\\]|\\.)+?)(?<!\s)\$(?!\d)`,
    ].join('|'),
    'g',
  )

  const mathSpan = (tex: string, display: boolean): string | null => {
    const { html, error } = renderMath(tex, display)
    if (!html) return null
    return stash(
      context,
      `<span class="math math--${display ? 'display' : 'inline'}${error ? ' math--error' : ''}"` +
        ` data-tex="${escapeHtml(tex)}"` +
        (error ? ` title="${escapeHtml(error)}"` : '') +
        `>${html}</span>`,
    )
  }

  text = text.replace(
    VERBATIM,
    (
      full: string,
      codeLead: string | undefined,
      _ticks: string | undefined,
      code: string | undefined,
      displayTex: string | undefined,
      mathLead: string | undefined,
      inlineTex: string | undefined,
    ) => {
      if (code !== undefined) {
        return (
          (codeLead ?? '') +
          stash(context, `<code>${escapeHtml(code.replace(/^ (.*) $/, '$1'))}</code>`)
        )
      }
      if (displayTex !== undefined) {
        return mathSpan(displayTex, true) ?? full
      }
      if (inlineTex !== undefined) {
        const span = mathSpan(inlineTex, false)
        return span === null ? full : (mathLead ?? '') + span
      }
      return full
    },
  )

  // Backslash escapes, once the verbatim spans are safely out of the way.
  text = text.replace(/\\([\\`*_{}[\]()#+\-.!|~>$])/g, (_full, char: string) =>
    stash(context, escapeHtml(char)),
  )

  // Images: ![alt](src "title")
  text = text.replace(
    /!\[([^\]]*)\]\(\s*<?([^)\s>]*)>?(?:\s+"([^"]*)")?\s*\)/g,
    (_full, alt: string, src: string, title?: string) => {
      const resolved =
        context.options.resolveImage && isLocalImagePath(src)
          ? context.options.resolveImage(src)
          : sanitizeUrl(src)
      if (!resolved) return stash(context, escapeHtml(alt))
      const titleAttribute = title ? ` title="${escapeHtml(title)}"` : ''
      return stash(
        context,
        `<img src="${escapeHtml(resolved)}" alt="${escapeHtml(alt)}"${titleAttribute} loading="lazy" data-src="${escapeHtml(src)}" />`,
      )
    },
  )

  // Wiki links.
  text = text.replace(/\[\[([^\]\n]*?)\]\]/g, (full, inner: string) => {
    const { target, heading, alias } = parseLinkTarget(inner)
    if (!target) return stash(context, escapeHtml(full))
    const resolver = context.options.resolveWikiLink
    const resolved = resolver ? resolver(target) : { href: '#', exists: true }
    const classes = resolved.exists ? 'wikilink' : 'wikilink wikilink--missing'
    const fragment = heading ? `#${heading}` : ''
    return stash(
      context,
      `<a class="${classes}" href="${escapeHtml(sanitizeUrl(resolved.href) || '#')}"` +
        ` data-wikilink="${escapeHtml(target)}" data-heading="${escapeHtml(heading ?? '')}"` +
        ` title="${escapeHtml(resolved.exists ? target : t.markdown.missingNote(target))}">` +
        `${escapeHtml(alias)}${escapeHtml(fragment)}</a>`,
    )
  })

  // Standard links: [text](href "title")
  text = text.replace(
    /\[([^\]]*)\]\(\s*<?([^)\s>]*)>?(?:\s+"([^"]*)")?\s*\)/g,
    (full, label: string, href: string, title?: string) => {
      const safe = sanitizeUrl(href)
      if (!safe) return stash(context, escapeHtml(label))
      const titleAttribute = title ? ` title="${escapeHtml(title)}"` : ''
      const external = /^(https?:|mailto:|tel:)/i.test(safe)
      const rel = external ? ' rel="noreferrer noopener" target="_blank"' : ''
      void full
      return stash(
        context,
        `<a href="${escapeHtml(safe)}"${titleAttribute}${rel}>${renderInline(label, options)}</a>`,
      )
    },
  )

  // Autolinks: <https://example.com> and bare URLs.
  text = text.replace(/<((?:https?:\/\/|mailto:)[^>\s]+)>/g, (_full, url: string) =>
    stash(
      context,
      `<a href="${escapeHtml(sanitizeUrl(url))}" rel="noreferrer noopener" target="_blank">${escapeHtml(url)}</a>`,
    ),
  )
  text = text.replace(/(^|[\s(])((?:https?:\/\/)[^\s<>()]+[^\s<>().,;:!?])/g, (_full, lead: string, url: string) =>
    lead +
    stash(
      context,
      `<a href="${escapeHtml(sanitizeUrl(url))}" rel="noreferrer noopener" target="_blank">${escapeHtml(url)}</a>`,
    ),
  )

  // Tags.
  text = text.replace(
    /(^|[^\p{L}\p{N}_&/#])#(\p{L}[\p{L}\p{N}_-]*(?:\/[\p{L}\p{N}_-]+)*)/gu,
    (full, lead: string, raw: string) => {
      const tag = normalizeTag(raw)
      if (!tag) return full
      return (
        lead +
        stash(
          context,
          `<a class="tag-chip" href="#tag/${encodeURIComponent(tag)}" data-tag="${escapeHtml(tag)}">#${escapeHtml(raw)}</a>`,
        )
      )
    },
  )

  // Everything that is left is literal text.
  text = escapeHtml(text)

  // Emphasis, after escaping so `<b>` typed by the user stays literal.
  text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>')
  text = text.replace(/(\*\*\*|___)(?=\S)([\s\S]*?\S)\1/g, '<strong><em>$2</em></strong>')
  text = text.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>')
  text = text.replace(/(?<![\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/g, '<em>$1</em>')
  text = text.replace(/(?<![\w_])_(?=\S)([^_\n]*?\S)_(?![\w_])/g, '<em>$1</em>')
  text = text.replace(/==([^=]+)==/g, '<mark>$1</mark>')

  // Hard line break: two trailing spaces, or a backslash, before a newline.
  text = text.replace(/ {2,}\n/g, '<br />\n')

  return restore(context, text)
}

interface BlockState {
  lines: string[]
  index: number
  taskIndex: number
  options: RenderOptions
}

const HEADING = /^[ \t]{0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/
const FENCE = /^([ \t]{0,3})(`{3,}|~{3,})[ \t]*([^\s`]*)[^\n]*$/
const HR = /^[ \t]{0,3}((?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/
const LIST_ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/
const TASK_MARK = /^\[([ xX])\][ \t]+(.*)$/
const BLOCKQUOTE = /^[ \t]{0,3}>[ \t]?(.*)$/
const TABLE_DELIMITER = /^[ \t]{0,3}\|?[ \t]*:?-{1,}:?[ \t]*(\|[ \t]*:?-{1,}:?[ \t]*)*\|?[ \t]*$/

function indentWidth(text: string): number {
  let width = 0
  for (const char of text) {
    if (char === ' ') width += 1
    else if (char === '\t') width += 4
    else break
  }
  return width
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let current = ''
  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i]
    if (char === '\\' && trimmed[i + 1] === '|') {
      current += '|'
      i += 1
      continue
    }
    if (char === '|') {
      cells.push(current.trim())
      current = ''
      continue
    }
    current += char ?? ''
  }
  cells.push(current.trim())
  return cells
}

function tableAlignments(delimiter: string): Array<'left' | 'center' | 'right' | null> {
  return splitTableRow(delimiter).map((cell) => {
    const left = cell.startsWith(':')
    const right = cell.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    if (left) return 'left'
    return null
  })
}

function renderTable(state: BlockState): string | null {
  const header = state.lines[state.index]
  const delimiter = state.lines[state.index + 1]
  if (header === undefined || delimiter === undefined) return null
  if (!header.includes('|')) return null
  if (!TABLE_DELIMITER.test(delimiter) || !delimiter.includes('-')) return null

  const headerCells = splitTableRow(header)
  const alignments = tableAlignments(delimiter)
  if (headerCells.length < 1 || alignments.length !== headerCells.length) return null

  state.index += 2
  const bodyRows: string[][] = []
  while (state.index < state.lines.length) {
    const line = state.lines[state.index]!
    if (!line.trim() || !line.includes('|')) break
    bodyRows.push(splitTableRow(line))
    state.index += 1
  }

  const align = (i: number) => {
    const value = alignments[i]
    return value ? ` style="text-align:${value}"` : ''
  }

  const head = headerCells.map((cell, i) => `<th${align(i)}>${renderInline(cell, state.options)}</th>`).join('')
  const body = bodyRows
    .map((row) => {
      const cells = headerCells.map(
        (_header, i) => `<td${align(i)}>${renderInline(row[i] ?? '', state.options)}</td>`,
      )
      return `<tr>${cells.join('')}</tr>`
    })
    .join('')

  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
}

function renderList(state: BlockState, baseIndent: number): string {
  const first = LIST_ITEM.exec(state.lines[state.index] ?? '')
  if (!first) return ''
  const ordered = /\d/.test(first[2] ?? '')
  const startAttribute = ordered
    ? (() => {
        const start = parseInt((first[2] ?? '1').replace(/[.)]/, ''), 10)
        return start !== 1 ? ` start="${start}"` : ''
      })()
    : ''

  const items: string[] = []
  let isTaskList = false

  while (state.index < state.lines.length) {
    const line = state.lines[state.index] ?? ''
    if (!line.trim()) {
      // A blank line ends the list unless the next line continues it.
      const next = state.lines[state.index + 1] ?? ''
      const nextIsItem = LIST_ITEM.test(next) && indentWidth(next) >= baseIndent
      const nextIsContinuation = next.trim() !== '' && indentWidth(next) > baseIndent
      if (!nextIsItem && !nextIsContinuation) break
      state.index += 1
      continue
    }

    const match = LIST_ITEM.exec(line)
    if (!match) break
    const indent = indentWidth(match[1] ?? '')
    if (indent < baseIndent) break
    if (indent > baseIndent) {
      // Nested list: attach it to the previous item.
      const nested = renderList(state, indent)
      if (items.length > 0) items[items.length - 1] += nested
      else items.push(nested)
      continue
    }

    const thisOrdered = /\d/.test(match[2] ?? '')
    if (thisOrdered !== ordered) break

    let content = match[3] ?? ''
    state.index += 1

    let checkbox = ''
    const task = TASK_MARK.exec(content)
    if (task) {
      isTaskList = true
      const checked = (task[1] ?? '').toLowerCase() === 'x'
      const disabled = state.options.interactiveTasks ? '' : ' disabled'
      checkbox =
        `<input type="checkbox" class="task-checkbox" data-task-index="${state.taskIndex}"` +
        `${checked ? ' checked' : ''}${disabled} />`
      state.taskIndex += 1
      content = task[2] ?? ''
    }

    // Lazy continuation lines belong to this item.
    const continuation: string[] = []
    while (state.index < state.lines.length) {
      const next = state.lines[state.index] ?? ''
      if (!next.trim()) break
      if (LIST_ITEM.test(next)) break
      if (indentWidth(next) <= baseIndent && HEADING.test(next)) break
      continuation.push(next.trim())
      state.index += 1
    }
    const text = [content, ...continuation].join('\n')

    const classAttribute = task ? ' class="task-item"' : ''
    items.push(`<li${classAttribute}>${checkbox}<span>${renderInline(text, state.options)}</span>`)
  }

  const closed = items.map((item) => (item.startsWith('<li') ? `${item}</li>` : item)).join('')
  const tag = ordered ? 'ol' : 'ul'
  const listClass = isTaskList ? ' class="task-list"' : ''
  return `<${tag}${listClass}${startAttribute}>${closed}</${tag}>`
}

/** Render a full Markdown document to HTML. */
export function renderMarkdown(source: string, options: RenderOptions = {}): string {
  const state: BlockState = {
    lines: (source ?? '').replace(/\r\n/g, '\n').split('\n'),
    index: 0,
    taskIndex: 0,
    options,
  }
  const out: string[] = []

  while (state.index < state.lines.length) {
    const line = state.lines[state.index] ?? ''

    if (!line.trim()) {
      state.index += 1
      continue
    }

    // A formula on its own: a line that opens with `$$`.
    //
    // Handled before fences and headings so the lines in between are taken as
    // LaTeX and never run through the Markdown passes -- `\frac{a}{b}` must
    // reach KaTeX exactly as it was typed.
    const mathOpen = /^[ \t]{0,3}\$\$(.*)$/.exec(line)
    if (mathOpen) {
      const rest = mathOpen[1] ?? ''
      const closingOnSameLine = /^(.*?)\$\$[ \t]*$/.exec(rest)
      let tex: string
      if (closingOnSameLine && rest.trim() !== '') {
        // `$$ ... $$` na jednom řádku.
        tex = closingOnSameLine[1] ?? ''
        state.index += 1
      } else {
        const body: string[] = []
        if (rest.trim()) body.push(rest)
        state.index += 1
        let closed = false
        while (state.index < state.lines.length) {
          const candidate = state.lines[state.index] ?? ''
          const closing = /^(.*?)\$\$[ \t]*$/.exec(candidate)
          if (closing) {
            if ((closing[1] ?? '').trim()) body.push(closing[1] ?? '')
            state.index += 1
            closed = true
            break
          }
          body.push(candidate)
          state.index += 1
        }
        void closed
        tex = body.join('\n')
      }

      const { html, error } = renderMath(tex, true)
      if (html) {
        out.push(
          `<div class="math math--block${error ? ' math--error' : ''}"` +
            ` data-tex="${escapeHtml(tex)}"` +
            (error ? ` title="${escapeHtml(error)}"` : '') +
            `>${html}</div>`,
        )
      }
      continue
    }

    const fence = FENCE.exec(line)
    if (fence) {
      // Blok pojmenovaný matematickým jazykem není kód, ale vzorec.
      //
      // Zápis je schválně stejný jako u bloku kódu: v jakémkoli jiném editoru
      // se ukáže jako kód, ne jako rozsypaný text, takže soubor zůstane všude
      // platným Markdownem.
      const fenceLanguage = mathLanguageByAlias((fence[3] ?? '').trim())
      if (fenceLanguage) {
        const marker = (fence[2] ?? '').charAt(0)
        const minLength = (fence[2] ?? '').length
        state.index += 1
        const body: string[] = []
        while (state.index < state.lines.length) {
          const candidate = state.lines[state.index] ?? ''
          const closing = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/.exec(candidate)
          if (closing && (closing[1] ?? '').charAt(0) === marker && (closing[1] ?? '').length >= minLength) {
            state.index += 1
            break
          }
          body.push(candidate)
          state.index += 1
        }
        const source = body.join('\n')
        const rendered = renderMathIn(source, fenceLanguage.id, true)
        const trouble = rendered.error ?? rendered.warnings[0] ?? ''
        if (rendered.html) {
          out.push(
            `<div class="math math--block${rendered.error ? ' math--error' : ''}` +
              `${!rendered.error && rendered.warnings.length > 0 ? ' math--warned' : ''}"` +
              ` data-tex="${escapeHtml(source)}" data-math-lang="${escapeHtml(fenceLanguage.id)}"` +
              (trouble ? ` title="${escapeHtml(trouble)}"` : '') +
              `>${rendered.html}</div>`,
          )
        } else {
          // Nevysázelo se nic: ukázat zdroj, ať není poznámka prázdná, a říct proč.
          out.push(
            `<div class="math math--block math--error" data-math-lang="${escapeHtml(fenceLanguage.id)}"` +
              ` data-tex="${escapeHtml(source)}"` +
              (trouble ? ` title="${escapeHtml(trouble)}"` : '') +
              `><pre><code>${escapeHtml(source)}</code></pre></div>`,
          )
        }
        continue
      }
      const marker = (fence[2] ?? '').charAt(0)
      const minLength = (fence[2] ?? '').length
      const language = (fence[3] ?? '').trim()
      state.index += 1
      const code: string[] = []
      while (state.index < state.lines.length) {
        const candidate = state.lines[state.index] ?? ''
        const closing = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/.exec(candidate)
        if (closing && (closing[1] ?? '').charAt(0) === marker && (closing[1] ?? '').length >= minLength) {
          state.index += 1
          break
        }
        code.push(candidate)
        state.index += 1
      }
      const languageClass = language ? ` class="language-${escapeHtml(language.toLowerCase())}"` : ''
      const label = language ? `<span class="code-lang">${escapeHtml(language)}</span>` : ''
      out.push(
        `<div class="code-block">${label}<pre><code${languageClass}>${escapeHtml(code.join('\n'))}</code></pre></div>`,
      )
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      const level = (heading[1] ?? '#').length
      const text = heading[2] ?? ''
      const id = text
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
      out.push(`<h${level} id="${escapeHtml(id)}">${renderInline(text, options)}</h${level}>`)
      state.index += 1
      continue
    }

    if (HR.test(line)) {
      out.push('<hr />')
      state.index += 1
      continue
    }

    if (BLOCKQUOTE.test(line)) {
      const quoted: string[] = []
      while (state.index < state.lines.length) {
        const candidate = state.lines[state.index] ?? ''
        const match = BLOCKQUOTE.exec(candidate)
        if (match) {
          quoted.push(match[1] ?? '')
          state.index += 1
          continue
        }
        if (candidate.trim() === '') break
        quoted.push(candidate)
        state.index += 1
      }
      const inner = renderMarkdown(quoted.join('\n'), options)
      out.push(`<blockquote>${inner}</blockquote>`)
      continue
    }

    if (LIST_ITEM.test(line)) {
      out.push(renderList(state, indentWidth(line)))
      continue
    }

    const table = renderTable(state)
    if (table !== null) {
      out.push(table)
      continue
    }

    // Indented code block.
    if (/^(\t| {4})/.test(line)) {
      const code: string[] = []
      while (state.index < state.lines.length) {
        const candidate = state.lines[state.index] ?? ''
        if (candidate.trim() !== '' && !/^(\t| {4})/.test(candidate)) break
        code.push(candidate.replace(/^(\t| {4})/, ''))
        state.index += 1
      }
      while (code.length > 0 && (code[code.length - 1] ?? '').trim() === '') code.pop()
      out.push(`<div class="code-block"><pre><code>${escapeHtml(code.join('\n'))}</code></pre></div>`)
      continue
    }

    // Paragraph: consume until a blank line or the start of another block.
    const paragraph: string[] = []
    while (state.index < state.lines.length) {
      const candidate = state.lines[state.index] ?? ''
      if (!candidate.trim()) break
      if (paragraph.length > 0) {
        if (HEADING.test(candidate) || FENCE.test(candidate) || HR.test(candidate)) break
        if (LIST_ITEM.test(candidate) || BLOCKQUOTE.test(candidate)) break
      }
      paragraph.push(candidate)
      state.index += 1
    }
    out.push(`<p>${renderInline(paragraph.join('\n'), options)}</p>`)
  }

  return out.join('\n')
}

/** Strip Markdown to plain text -- used for search snippets and exports. */
export function toPlainText(source: string): string {
  // Block boundaries become spaces so words do not run together; inline tags
  // vanish entirely, so `<code>x</code>.` reads as `x.` and not `x .`.
  const BLOCK_TAG = /<\/?(?:p|div|h[1-6]|li|ul|ol|tr|td|th|br|hr|blockquote|pre|table|thead|tbody)\b[^>]*>/gi
  return renderMarkdown(source)
    .replace(BLOCK_TAG, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}
