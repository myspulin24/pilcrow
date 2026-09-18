import { describe, expect, it } from 'vitest'

import {
  buildLinkIndex,
  computeBacklinks,
  findWikiLinks,
  insertLink,
  linkKey,
  parseLinkTarget,
  resolveLink,
  rewriteLinks,
  snippetAround,
} from './wikilinks'

describe('parseLinkTarget', () => {
  it('handles every supported form', () => {
    expect(parseLinkTarget('Target')).toEqual({ target: 'Target', heading: null, alias: 'Target' })
    expect(parseLinkTarget('Target|Display')).toEqual({ target: 'Target', heading: null, alias: 'Display' })
    expect(parseLinkTarget('Target#Heading')).toEqual({
      target: 'Target',
      heading: 'Heading',
      alias: 'Target#Heading',
    })
    expect(parseLinkTarget('Target#Heading|Display')).toEqual({
      target: 'Target',
      heading: 'Heading',
      alias: 'Display',
    })
    expect(parseLinkTarget('folder/Target')).toEqual({
      target: 'folder/Target',
      heading: null,
      alias: 'folder/Target',
    })
  })

  it('trims whitespace around the parts', () => {
    expect(parseLinkTarget('  Target  |  Display  ')).toEqual({
      target: 'Target',
      heading: null,
      alias: 'Display',
    })
  })
})

describe('findWikiLinks', () => {
  it('finds links and reports slices of the original text', () => {
    const body = 'See [[One]] and [[two|Second]].'
    const links = findWikiLinks(body)

    expect(links.map((link) => link.target)).toEqual(['One', 'two'])
    expect(body.slice(links[0]!.start, links[0]!.end)).toBe('[[One]]')
    expect(links[1]!.alias).toBe('Second')
  })

  it('ignores links inside code', () => {
    expect(findWikiLinks('`[[nope]]` and\n\n```\n[[alsonope]]\n```')).toEqual([])
  })

  it('ignores an empty target', () => {
    expect(findWikiLinks('[[]] and [[ ]]')).toEqual([])
  })

  it('does not span newlines', () => {
    expect(findWikiLinks('[[start\nend]]')).toEqual([])
  })
})

describe('linkKey', () => {
  it('normalises case, extension and separators', () => {
    expect(linkKey('Notes/My Note.md')).toBe('notes/my note')
    expect(linkKey('notes\\my note')).toBe('notes/my note')
    expect(linkKey('./Foo.MD')).toBe('foo')
    expect(linkKey('  Spaced   Out  ')).toBe('spaced out')
  })

  it('treats a decomposed accent as the same character as a composed one', () => {
    // What macOS hands back (NFD) vs what Windows stores (NFC). Same note.
    const decomposed = 'Čtení' // Čtení, with the caron as its own code point
    const composed = 'Čtení'
    expect(decomposed).not.toBe(composed)
    expect(linkKey(decomposed)).toBe(linkKey(composed))
    expect(linkKey(decomposed)).toBe('čtení')
  })
})

describe('buildLinkIndex / resolveLink', () => {
  const notes = [
    { path: 'welcome.md', title: 'Welcome to Pilcrow' },
    { path: 'daily/2026-09-15.md', title: '2026-09-15' },
    { path: 'projects/acme.md', title: 'Acme' },
  ]
  const index = buildLinkIndex(notes)

  it('resolves by title, by file name and by full path', () => {
    expect(resolveLink(index, 'Welcome to Pilcrow')).toBe('welcome.md')
    expect(resolveLink(index, 'welcome')).toBe('welcome.md')
    expect(resolveLink(index, 'welcome.md')).toBe('welcome.md')
    expect(resolveLink(index, 'projects/acme')).toBe('projects/acme.md')
    expect(resolveLink(index, '2026-09-15')).toBe('daily/2026-09-15.md')
  })

  it('is case-insensitive', () => {
    expect(resolveLink(index, 'WELCOME TO PILCROW')).toBe('welcome.md')
  })

  it('returns null for a target that does not exist', () => {
    expect(resolveLink(index, 'Nothing here')).toBeNull()
  })

  it('lets an exact path win over a title that collides with it', () => {
    // A note literally titled "welcome" must not shadow the file `welcome.md`.
    const colliding = buildLinkIndex([
      { path: 'welcome.md', title: 'Welcome to Pilcrow' },
      { path: 'other.md', title: 'welcome' },
    ])
    expect(resolveLink(colliding, 'welcome')).toBe('welcome.md')
  })
})

describe('computeBacklinks', () => {
  const notes = [
    { path: 'a.md', title: 'Alpha', body: 'Links to [[Beta]] here.' },
    { path: 'b.md', title: 'Beta', body: 'Nothing.' },
    { path: 'c.md', title: 'Gamma', body: 'Also [[b|the second one]].' },
  ]

  it('finds every note pointing at a target, by title or by path', () => {
    const inbound = computeBacklinks('b.md', notes)
    expect(inbound.map((link) => link.from).sort()).toEqual(['a.md', 'c.md'])
    expect(inbound.find((link) => link.from === 'a.md')?.context).toBe('Links to [[Beta]] here.')
  })

  it('never reports a note as linking to itself', () => {
    expect(computeBacklinks('self.md', [{ path: 'self.md', title: 'Self', body: 'See [[Self]].' }])).toEqual([])
  })
})

describe('snippetAround', () => {
  it('returns the whole line when it is short', () => {
    const text = 'a short line with [[a link]] in it'
    expect(snippetAround(text, 18, 28)).toBe(text)
  })

  it('ellipsises a very long line around the hit', () => {
    const text = `${'x'.repeat(300)}[[target]]${'y'.repeat(300)}`
    const snippet = snippetAround(text, 300, 310)
    expect(snippet.startsWith('...')).toBe(true)
    expect(snippet.endsWith('...')).toBe(true)
    expect(snippet).toContain('[[target]]')
  })
})

describe('rewriteLinks', () => {
  const matches = (target: string) => linkKey(target) === linkKey('old name')

  it('rewrites matching links and leaves the rest alone', () => {
    const body = 'Go to [[Old name]] or [[Other]].'
    const result = rewriteLinks(body, matches, 'New name')
    expect(result.changed).toBe(1)
    expect(result.body).toBe('Go to [[New name]] or [[Other]].')
  })

  it('preserves an explicit alias and a heading fragment', () => {
    const result = rewriteLinks('[[Old name#Section|click me]]', matches, 'New name')
    expect(result.body).toBe('[[New name#Section|click me]]')
  })

  it('does not invent an alias where there was none', () => {
    expect(rewriteLinks('[[Old name]]', matches, 'New name').body).toBe('[[New name]]')
  })

  it('returns the original string when nothing matched', () => {
    const body = 'Nothing to see [[Other]].'
    const result = rewriteLinks(body, matches, 'New name')
    expect(result.changed).toBe(0)
    expect(result.body).toBe(body)
  })

  it('rewrites several links in one body without corrupting offsets', () => {
    const body = '[[Old name]] then [[Old name|alias]] then [[Old name]]'
    const result = rewriteLinks(body, matches, 'Fresh')
    expect(result.changed).toBe(3)
    expect(result.body).toBe('[[Fresh]] then [[Fresh|alias]] then [[Fresh]]')
  })

  it('leaves links inside code untouched', () => {
    expect(rewriteLinks('`[[Old name]]`', matches, 'New').body).toBe('`[[Old name]]`')
  })
})

describe('insertLink', () => {
  it('inserts a plain link at the caret', () => {
    const { body, caret } = insertLink('start  end', 6, 6, 'Target')
    expect(body).toBe('start [[Target]] end')
    expect(caret).toBe(6 + '[[Target]]'.length)
  })

  it('turns a selection into the link alias', () => {
    const { body } = insertLink('see that note now', 4, 13, 'The Note')
    expect(body).toBe('see [[The Note|that note]] now')
  })

  it('does not alias when the selection already equals the target', () => {
    expect(insertLink('see Target now', 4, 10, 'Target').body).toBe('see [[Target]] now')
  })
})
