/**
 * Lišta formátování nad editorem.
 *
 * Reader_MJ ukládá poznámky jako Markdown, protože to je obyčejný text, který
 * přežije tuhle i každou další aplikaci. To ale neznamená, že se ho někdo musí
 * učit. Lišta dělá přesně to, co lišta ve Wordu: klikneš na tučné a text je
 * tučný. Že se tomu v souboru říká `**takhle**`, je vidět až když se někdo
 * podívá do zdroje.
 *
 * Každé tlačítko má náhled -- kousek Markdownu a vedle něj to, jak bude
 * vypadat vysázený. Náhled vykresluje ten samý renderer jako celá poznámka,
 * takže nemůže tvrdit něco jiného, než se pak stane.
 */

import { useMemo, useState } from 'react'

import { renderMarkdown, t, type FormatId } from '@/core'

interface Button {
  id: FormatId | 'mathEditor'
  /** Co je na tlačítku vidět. */
  glyph: string
  label: string
  /** Ukázka Markdownu do náhledu. */
  sample: string
  /** Vlastní třída pro glyf (tučné B, kurzívní I...). */
  glyphClass?: string
  shortcut?: string
}

interface Group {
  name: string
  buttons: Button[]
}

const GROUPS: Group[] = [
  {
    name: t.toolbar.groups.text,
    buttons: [
      { id: 'bold', glyph: 'B', label: t.toolbar.bold, sample: '**tučný text**', glyphClass: 'is-bold', shortcut: 'Ctrl + B' },
      { id: 'italic', glyph: 'I', label: t.toolbar.italic, sample: '*kurzíva*', glyphClass: 'is-italic', shortcut: 'Ctrl + I' },
      { id: 'strike', glyph: 'S', label: t.toolbar.strike, sample: '~~přeškrtnuté~~', glyphClass: 'is-strike' },
      { id: 'highlight', glyph: '▮', label: t.toolbar.highlight, sample: '==zvýrazněné==' },
      { id: 'code', glyph: '‹›', label: t.toolbar.code, sample: '`kód`' },
    ],
  },
  {
    name: t.toolbar.groups.headings,
    buttons: [
      { id: 'h1', glyph: 'H1', label: t.toolbar.h1, sample: '# Nadpis' },
      { id: 'h2', glyph: 'H2', label: t.toolbar.h2, sample: '## Nadpis' },
      { id: 'h3', glyph: 'H3', label: t.toolbar.h3, sample: '### Nadpis' },
    ],
  },
  {
    name: t.toolbar.groups.lists,
    buttons: [
      { id: 'ul', glyph: '•', label: t.toolbar.ul, sample: '- první\n- druhá' },
      { id: 'ol', glyph: '1.', label: t.toolbar.ol, sample: '1. první\n2. druhá' },
      { id: 'task', glyph: '☑', label: t.toolbar.task, sample: '- [ ] nehotovo\n- [x] hotovo' },
      { id: 'quote', glyph: '❝', label: t.toolbar.quote, sample: '> citace' },
    ],
  },
  {
    name: t.toolbar.groups.blocks,
    buttons: [
      { id: 'codeblock', glyph: '⌗', label: t.toolbar.codeblock, sample: '```\nconst x = 1\n```' },
      { id: 'table', glyph: '▦', label: t.toolbar.table, sample: '| Město | Kraj |\n| --- | --- |\n| Brno | JMK |' },
      { id: 'rule', glyph: '—', label: t.toolbar.rule, sample: 'nad\n\n---\n\npod' },
    ],
  },
  {
    name: t.toolbar.groups.links,
    buttons: [
      { id: 'link', glyph: '🔗', label: t.toolbar.link, sample: '[Reader_MJ](https://example.com)' },
      { id: 'wikilink', glyph: '[[]]', label: t.toolbar.wikilink, sample: '[[Jiná poznámka]]' },
      { id: 'image', glyph: '🖼', label: t.toolbar.image, sample: '![popis](obrazek.png)' },
    ],
  },
  {
    name: t.toolbar.groups.math,
    buttons: [
      { id: 'mathInline', glyph: '$x$', label: t.toolbar.mathInline, sample: 'Platí $E = mc^2$ a nic víc.' },
      {
        id: 'mathEditor',
        glyph: '∑',
        label: t.toolbar.mathEditor,
        sample: '$$\nc_{right} = \\frac{3^k}{2^n}\n$$',
        shortcut: 'Ctrl + M',
      },
    ],
  },
]

/** Náhled: zdroj Markdownu a vedle něj hotový výsledek. */
function Preview({ button }: { button: Button }) {
  const html = useMemo(() => renderMarkdown(button.sample), [button.sample])

  return (
    <div className="toolbar__preview" role="tooltip">
      <div className="toolbar__preview-head">
        <strong>{button.label}</strong>
        {button.shortcut ? <span className="toolbar__shortcut">{button.shortcut}</span> : null}
      </div>
      <div className="toolbar__preview-source">
        <span className="toolbar__preview-caption">{t.toolbar.inserts}</span>
        <pre>{button.sample}</pre>
      </div>
      <div className="toolbar__preview-result">
        <span className="toolbar__preview-caption">{t.toolbar.preview}</span>
        {/* Stejný renderer jako u poznámky: escapuje u zdroje a kontroluje
            schéma každé URL. */}
        <div className="markdown markdown--compact" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  )
}

export function Toolbar({
  onFormat,
  onOpenMath,
}: {
  onFormat: (id: FormatId) => void
  onOpenMath: () => void
}) {
  const [hovered, setHovered] = useState<string | null>(null)

  return (
    <div className="toolbar" role="toolbar" aria-label={t.toolbar.label}>
      {GROUPS.map((group, index) => (
        <div className="toolbar__group" key={group.name} aria-label={group.name} role="group">
          {index > 0 ? <span className="toolbar__divider" aria-hidden="true" /> : null}
          {group.buttons.map((button) => (
            <span className="toolbar__slot" key={button.id}>
              <button
                type="button"
                className="toolbar__button"
                aria-label={button.label}
                title={button.label}
                // Bez tohohle textarea při kliknutí ztratí kurzor a formátování
                // by nemělo co obalit.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() =>
                  button.id === 'mathEditor' ? onOpenMath() : onFormat(button.id as FormatId)
                }
                onMouseEnter={() => setHovered(button.id)}
                onMouseLeave={() => setHovered((current) => (current === button.id ? null : current))}
                onFocus={() => setHovered(button.id)}
                onBlur={() => setHovered((current) => (current === button.id ? null : current))}
              >
                <span className={`toolbar__glyph ${button.glyphClass ?? ''}`} aria-hidden="true">
                  {button.glyph}
                </span>
              </button>
              {hovered === button.id ? <Preview button={button} /> : null}
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}
