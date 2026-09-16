import { describe, expect, it } from 'vitest'

import { escapeHtml, isLocalImagePath, renderInline, renderMarkdown, sanitizeUrl, toPlainText } from './markdown'

describe('escaping and URL safety', () => {
  it('escapes HTML in text', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
    )
  })

  it('renders user-typed HTML as literal text, not markup', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img')
  })

  it('strips javascript: and data: URLs from links', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBe('')
    expect(sanitizeUrl('data:text/html,<script>')).toBe('')
    expect(sanitizeUrl('  JaVaScRiPt:alert(1)')).toBe('')

    const html = renderMarkdown('[click](javascript:alert(1))')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('click')
  })

  it('keeps ordinary and relative URLs', () => {
    expect(sanitizeUrl('https://example.com')).toBe('https://example.com')
    expect(sanitizeUrl('mailto:a@b.test')).toBe('mailto:a@b.test')
    expect(sanitizeUrl('attachments/cat.png')).toBe('attachments/cat.png')
    expect(sanitizeUrl('#heading')).toBe('#heading')
  })

  it('cannot be tricked into forging an internal placeholder', () => {
    // The renderer stashes rendered fragments behind sentinel characters.
    const html = renderMarkdown('literal \u0000123\u0001 text')
    expect(html).toContain('literal')
    expect(html).toContain('text')
    expect(html).not.toContain('\u0000')
  })
})

describe('block rendering', () => {
  it('renders headings with slug ids', () => {
    expect(renderMarkdown('# Hello World')).toBe('<h1 id="hello-world">Hello World</h1>')
    expect(renderMarkdown('### Third')).toContain('<h3 id="third">')
  })

  it('renders paragraphs and horizontal rules', () => {
    expect(renderMarkdown('one\n\ntwo')).toBe('<p>one</p>\n<p>two</p>')
    expect(renderMarkdown('---')).toBe('<hr />')
  })

  it('renders fenced code blocks with the language label and escapes the content', () => {
    const html = renderMarkdown('```ts\nconst a = 1 < 2\n```')
    expect(html).toContain('class="language-ts"')
    expect(html).toContain('<span class="code-lang">ts</span>')
    expect(html).toContain('const a = 1 &lt; 2')
  })

  it('does not interpret Markdown inside a code block', () => {
    const html = renderMarkdown('```\n# not a heading\n**not bold**\n[[not a link]]\n```')
    expect(html).not.toContain('<h1')
    expect(html).not.toContain('<strong>')
    expect(html).not.toContain('wikilink')
  })

  it('closes an unterminated fence at the end of the document', () => {
    const html = renderMarkdown('```\nunclosed')
    expect(html).toContain('<pre><code>unclosed</code></pre>')
  })

  it('renders blockquotes, including nested blocks', () => {
    const html = renderMarkdown('> quoted **text**\n> - a list item')
    expect(html).toContain('<blockquote>')
    expect(html).toContain('<strong>text</strong>')
    expect(html).toContain('<li>')
  })

  it('renders indented code blocks', () => {
    expect(renderMarkdown('paragraph\n\n    indented code')).toContain('<code>indented code</code>')
  })
})

describe('lists', () => {
  it('renders unordered and ordered lists', () => {
    expect(renderMarkdown('- a\n- b')).toBe('<ul><li><span>a</span></li><li><span>b</span></li></ul>')
    expect(renderMarkdown('1. a\n2. b')).toContain('<ol>')
  })

  it('honours a non-1 start on an ordered list', () => {
    expect(renderMarkdown('3. three\n4. four')).toContain('<ol start="3">')
  })

  it('nests sub-lists inside the parent item', () => {
    const html = renderMarkdown('- parent\n  - child')
    expect(html).toContain('<ul><li><span>parent</span><ul><li><span>child</span></li></ul></li></ul>')
  })

  it('renders task lists with sequential indices', () => {
    const html = renderMarkdown('- [ ] todo\n- [x] done\n- [ ] later')
    expect(html).toContain('class="task-list"')
    expect(html).toContain('data-task-index="0"')
    expect(html).toContain('data-task-index="1"')
    expect(html).toContain('data-task-index="2"')
    expect((html.match(/checked/g) ?? []).length).toBe(1)
  })

  it('disables checkboxes unless interactive tasks are requested', () => {
    expect(renderMarkdown('- [ ] a')).toContain('disabled')
    expect(renderMarkdown('- [ ] a', { interactiveTasks: true })).not.toContain('disabled')
  })

  it('numbers task indices across nesting in document order', () => {
    const html = renderMarkdown('- [ ] first\n  - [ ] nested\n- [ ] third')
    expect(html.indexOf('data-task-index="0"')).toBeLessThan(html.indexOf('data-task-index="1"'))
    expect(html).toContain('data-task-index="2"')
  })
})

describe('tables', () => {
  it('renders a pipe table with a header row', () => {
    const html = renderMarkdown('| A | B |\n| --- | --- |\n| 1 | 2 |')
    expect(html).toContain('<th>A</th>')
    expect(html).toContain('<td>1</td>')
    expect(html).toContain('<div class="table-wrap">')
  })

  it('applies column alignment', () => {
    const html = renderMarkdown('| L | C | R |\n| :-- | :-: | --: |\n| a | b | c |')
    expect(html).toContain('style="text-align:left"')
    expect(html).toContain('style="text-align:center"')
    expect(html).toContain('style="text-align:right"')
  })

  it('pads rows that are missing trailing cells', () => {
    const html = renderMarkdown('| A | B |\n| --- | --- |\n| only |')
    expect(html).toContain('<td>only</td><td></td>')
  })

  it('does not treat a lone pipe line as a table', () => {
    expect(renderMarkdown('a | b')).toBe('<p>a | b</p>')
  })
})

describe('inline rendering', () => {
  it('renders emphasis, strong, strikethrough and highlight', () => {
    expect(renderInline('*em*')).toBe('<em>em</em>')
    expect(renderInline('**strong**')).toBe('<strong>strong</strong>')
    expect(renderInline('***both***')).toBe('<strong><em>both</em></strong>')
    expect(renderInline('~~gone~~')).toBe('<del>gone</del>')
    expect(renderInline('==hot==')).toBe('<mark>hot</mark>')
  })

  it('does not italicise underscores inside words', () => {
    expect(renderInline('snake_case_name')).toBe('snake_case_name')
  })

  it('renders inline code without interpreting it', () => {
    expect(renderInline('`a *b* c`')).toBe('<code>a *b* c</code>')
  })

  it('honours backslash escapes', () => {
    expect(renderInline('\\*not em\\*')).toBe('*not em*')
    expect(renderInline('\\[\\[not a link\\]\\]')).toBe('[[not a link]]')
  })

  it('autolinks bare URLs without swallowing trailing punctuation', () => {
    const html = renderInline('see https://example.com/page.')
    expect(html).toContain('href="https://example.com/page"')
    expect(html).toMatch(/<\/a>\.$/)
  })

  it('opens external links in a new window but not internal ones', () => {
    expect(renderInline('[x](https://example.com)')).toContain('target="_blank"')
    expect(renderInline('[x](#section)')).not.toContain('target="_blank"')
  })
})

describe('wiki links and tags', () => {
  const options = {
    resolveWikiLink: (target: string) => ({
      href: `#note/${target}`,
      exists: target === 'Exists',
    }),
  }

  it('marks resolved and unresolved links differently', () => {
    const resolved = renderInline('[[Exists]]', options)
    expect(resolved).toContain('class="wikilink"')
    expect(resolved).toContain('data-wikilink="Exists"')

    const missing = renderInline('[[Missing]]', options)
    expect(missing).toContain('wikilink--missing')
    expect(missing).toContain('zatím neexistuje')
  })

  it('shows the alias and carries the heading', () => {
    const html = renderInline('[[Exists#Part|Display]]', options)
    expect(html).toContain('>Display#Part</a>')
    expect(html).toContain('data-heading="Part"')
  })

  it('escapes a hostile link target', () => {
    const html = renderInline('[[<script>]]', {
      resolveWikiLink: () => ({ href: 'javascript:alert(1)', exists: true }),
    })
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('javascript:')
  })

  it('renders tags as clickable chips', () => {
    const html = renderInline('about #work/acme today')
    expect(html).toContain('data-tag="work/acme"')
    expect(html).toContain('>#work/acme</a>')
  })

  it('does not turn a heading into a tag', () => {
    expect(renderMarkdown('# Heading')).not.toContain('data-tag')
  })
})

describe('images', () => {
  it('detects local image paths', () => {
    expect(isLocalImagePath('attachments/cat.png')).toBe(true)
    expect(isLocalImagePath('attachments/cat.PNG')).toBe(true)
    expect(isLocalImagePath('https://example.com/cat.png')).toBe(false)
    expect(isLocalImagePath('notes/doc.md')).toBe(false)
  })

  it('rewrites local images through the resolver and keeps the original path', () => {
    const html = renderInline('![a cat](attachments/cat.png)', {
      resolveImage: (src) => `asset://localhost/vault/${src}`,
    })
    expect(html).toContain('src="asset://localhost/vault/attachments/cat.png"')
    expect(html).toContain('data-src="attachments/cat.png"')
    expect(html).toContain('alt="a cat"')
  })

  it('leaves remote images alone', () => {
    const html = renderInline('![x](https://example.com/cat.png)', {
      resolveImage: () => 'SHOULD NOT BE USED',
    })
    expect(html).toContain('src="https://example.com/cat.png"')
  })

  it('degrades an unsafe image to its alt text', () => {
    expect(renderInline('![alt](javascript:alert)')).toBe('alt')

    // With unbalanced parens the destination parse stops early, which is fine:
    // what matters is that no <img> and no javascript: URL survive.
    const messy = renderInline('![alt](javascript:alert(1))')
    expect(messy).not.toContain('<img')
    expect(messy).not.toContain('javascript:')
    expect(messy).toContain('alt')
  })
})

describe('toPlainText', () => {
  it('reduces a document to readable prose', () => {
    const text = toPlainText('# Title\n\nSome **bold** text and `code`.\n\n- a\n- b')
    expect(text).toBe('Title Some bold text and code. a b')
  })
})

describe('robustness', () => {
  it('never throws on adversarial input', () => {
    const inputs = [
      '',
      '*'.repeat(500),
      '['.repeat(200),
      '|'.repeat(200),
      '```'.repeat(50),
      '- '.repeat(500),
      '> '.repeat(200),
      '[[' + 'a'.repeat(1000) + ']]',
      '\u0000\u0001\u0002',
    ]
    for (const input of inputs) {
      expect(() => renderMarkdown(input)).not.toThrow()
    }
  })
})
