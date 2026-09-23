import { describe, expect, it } from 'vitest'

import { maskCode } from './mask'
import { collectTags, expandTagAncestors, findInlineTags, normalizeTag, renameTagInBody } from './tags'

describe('maskCode', () => {
  it('returns a string of the same length so offsets stay valid', () => {
    const body = 'text `code` more\n\n```\nfenced\n```\n\ntail'
    expect(maskCode(body)).toHaveLength(body.length)
  })

  it('blanks fenced blocks, inline code and URLs', () => {
    const body = ['before', '```sh', '#!/bin/sh', '```', 'after `#inline` end', 'see https://x.test/#frag'].join('\n')
    const masked = maskCode(body)
    expect(masked).toContain('before')
    expect(masked).toContain('after')
    expect(masked).not.toContain('#!/bin/sh')
    expect(masked).not.toContain('#inline')
    expect(masked).not.toContain('#frag')
  })

  it('blanks an unterminated fence to the end of the document', () => {
    const masked = maskCode('ok\n```\n#not-a-tag\nstill code')
    expect(masked).not.toContain('#not-a-tag')
  })
})

describe('normalizeTag', () => {
  it('lowercases, strips the hash and trims punctuation', () => {
    expect(normalizeTag('#Work')).toBe('work')
    expect(normalizeTag('Work/Clients/ACME')).toBe('work/clients/acme')
    expect(normalizeTag('#idea,')).toBe('idea')
    expect(normalizeTag('#idea.')).toBe('idea')
  })

  it('collapses separators and drops empty segments', () => {
    expect(normalizeTag('a//b')).toBe('a/b')
    expect(normalizeTag('/a/b/')).toBe('a/b')
    expect(normalizeTag('a\\b')).toBe('a/b')
  })

  it('rejects tags that do not start with a letter', () => {
    // Otherwise `#404` in prose and `#fff` in CSS become tags.
    expect(normalizeTag('#404')).toBe('')
    expect(normalizeTag('#')).toBe('')
    expect(normalizeTag('#-')).toBe('')
  })
})

describe('findInlineTags', () => {
  it('finds tags at the start of a line, mid-sentence and in parentheses', () => {
    const body = '#first line\nmid #second sentence\n(#third)'
    expect(findInlineTags(body).map((tag) => tag.tag)).toEqual(['first', 'second', 'third'])
  })

  it('does not treat a heading as a tag', () => {
    expect(findInlineTags('# Heading\n## Another')).toEqual([])
  })

  it('does not treat C# or an HTML entity as a tag', () => {
    expect(findInlineTags('I write C# and &#39; entities').map((tag) => tag.tag)).toEqual([])
  })

  it('ignores tags inside code', () => {
    expect(findInlineTags('`#nope` and\n\n```\n#alsonope\n```')).toEqual([])
  })

  it('ignores a URL fragment', () => {
    expect(findInlineTags('see https://example.com/page#section')).toEqual([])
  })

  it('reports offsets that slice the original text', () => {
    const body = 'hello #world!'
    const [found] = findInlineTags(body)
    expect(found).toBeDefined()
    expect(body.slice(found!.start, found!.end)).toBe('#world')
  })

  it('finds two adjacent tags', () => {
    expect(findInlineTags('#one #two').map((tag) => tag.tag)).toEqual(['one', 'two'])
  })
})

describe('collectTags', () => {
  it('merges, normalises, de-duplicates and sorts', () => {
    expect(collectTags(['Beta', 'alpha'], 'body with #alpha and #Gamma')).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('drops frontmatter tags that normalise to nothing', () => {
    expect(collectTags(['', '  ', '###'], 'clean')).toEqual([])
  })
})

describe('expandTagAncestors', () => {
  it('yields every prefix so parent tags match children', () => {
    expect(expandTagAncestors('a/b/c')).toEqual(['a', 'a/b', 'a/b/c'])
    expect(expandTagAncestors('solo')).toEqual(['solo'])
  })
})

describe('renameTagInBody', () => {
  it('renames a tag and its descendants', () => {
    const body = 'about #work and #work/admin and #workshop'
    expect(renameTagInBody(body, 'work', 'job')).toBe('about #job and #job/admin and #workshop')
  })

  it('leaves code alone', () => {
    const body = 'real #work but `#work` stays'
    expect(renameTagInBody(body, 'work', 'job')).toBe('real #job but `#work` stays')
  })

  it('is a no-op when the tag is absent or unchanged', () => {
    expect(renameTagInBody('no tags here', 'work', 'job')).toBe('no tags here')
    expect(renameTagInBody('#work', 'work', 'work')).toBe('#work')
  })
})

describe('Czech tags', () => {
  it('keeps diacritics instead of folding them to dashes', () => {
    expect(normalizeTag('#nápad')).toBe('nápad')
    expect(normalizeTag('#Řízení/Úkoly')).toBe('řízení/úkoly')
    expect(normalizeTag('#práce')).toBe('práce')
  })

  it('finds them inline', () => {
    expect(findInlineTags('dnes #schůzka a #práce/klienti').map((tag) => tag.tag)).toEqual([
      'schůzka',
      'práce/klienti',
    ])
  })

  it('still refuses a tag that does not start with a letter', () => {
    expect(normalizeTag('#404')).toBe('')
    expect(normalizeTag('#-ěšč')).toBe('ěšč')
  })

  it('does not treat a hash after a Czech letter as a tag', () => {
    expect(findInlineTags('č#tohle')).toEqual([])
  })
})
