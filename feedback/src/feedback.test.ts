import { describe, expect, it } from 'vitest'

import { base64Size, issueBody, issueTitle, neutralise, safeFileName, validateFeedback, type Feedback } from './feedback'

const valid = {
  kind: 'bug',
  message: 'Okno větví se nezavře Escapem.\n\nDruhý řádek.',
  context: {
    version: '0.12.0',
    os: 'windows (x86_64)',
    location: 'Poznámka v trezoru',
    element: { label: 'tlačítko „Větve…“ · Pracovní plocha › Git', path: 'section#ws-git button.git__branch-button' },
  },
  author: { name: 'Michal Jašek', email: 'michal@example.com' },
  attachment: null,
}

describe('validateFeedback', () => {
  it('přijme platný feedback', () => {
    const result = validateFeedback(valid)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.feedback.context.element?.label).toContain('Větve')
  })

  it('anonymní feedback nemá autora', () => {
    const result = validateFeedback({ ...valid, author: null })
    expect(result.ok && result.feedback.author).toBeNull()
  })

  it('odmítne prázdnou zprávu, cizí druh a dlouhý text', () => {
    expect(validateFeedback({ ...valid, message: '   ' })).toEqual({ ok: false, error: 'Zpráva je prázdná.' })
    expect(validateFeedback({ ...valid, kind: 'spam' }).ok).toBe(false)
    expect(validateFeedback({ ...valid, message: 'x'.repeat(10_001) }).ok).toBe(false)
    expect(validateFeedback('nesmysl').ok).toBe(false)
    expect(validateFeedback({ ...valid, author: { name: 'A', email: 'neni-email' } }).ok).toBe(false)
  })

  it('příloha: jen povolené typy, jen do 2 MB, jen platné base64', () => {
    const png = { name: 'snimek.png', type: 'image/png', data: btoa('obrázek'.replace(/[^\x00-\x7f]/g, 'x')) }
    expect(validateFeedback({ ...valid, attachment: png }).ok).toBe(true)
    expect(validateFeedback({ ...valid, attachment: { ...png, name: 'virus.exe', type: 'application/x-msdownload' } }).ok).toBe(false)
    // Přípona musí sedět s typem.
    expect(validateFeedback({ ...valid, attachment: { ...png, name: 'snimek.exe' } }).ok).toBe(false)
    expect(validateFeedback({ ...valid, attachment: { ...png, data: 'není base64!' } }).ok).toBe(false)
    const big = 'A'.repeat(Math.ceil((2 * 1024 * 1024 + 3) / 3) * 4)
    expect(validateFeedback({ ...valid, attachment: { ...png, data: big } })).toEqual({
      ok: false,
      error: 'Příloha je větší než 2 MB.',
    })
  })
})

describe('pomocníci', () => {
  it('velikost base64 bez dekódování', () => {
    expect(base64Size(btoa('abc'))).toBe(3)
    expect(base64Size(btoa('ab'))).toBe(2)
    expect(base64Size(btoa('a'))).toBe(1)
    expect(base64Size('abc')).toBeNull()
  })

  it('jméno přílohy jako bezpečná cesta', () => {
    expect(safeFileName('Snímek obrazovky 2026-10-01.png')).toBe('Snimek-obrazovky-2026-10-01.png')
    expect(safeFileName('../../etc/passwd')).toBe('passwd')
    expect(safeFileName('C:\\Users\\a\\log.txt')).toBe('log.txt')
    expect(safeFileName('...')).toBe('priloha')
  })

  it('zmínky v textu nikoho neupozorní', () => {
    expect(neutralise('ahoj @myspulin24')).not.toContain('@myspulin24')
    expect(neutralise('(@myspulin24)')).not.toContain('@myspulin24')
    expect(neutralise('mail@example.com')).toBe('mail@example.com')
  })
})

describe('issue', () => {
  const feedback = (validateFeedback(valid) as { ok: true; feedback: Feedback }).feedback

  it('název: druh a první řádek', () => {
    expect(issueTitle(feedback)).toBe('[Bug] Okno větví se nezavře Escapem.')
    const long = { ...feedback, kind: 'improvement' as const, message: 'x'.repeat(200) }
    expect(issueTitle(long).length).toBeLessThanOrEqual(80 + '[Vylepšení] '.length)
  })

  it('tělo: zpráva, kontext a příloha', () => {
    const body = issueBody(
      { ...feedback, attachment: { name: 'snimek.png', type: 'image/png', data: 'AAAA' } },
      { id: 'abcd1234', receivedAt: '2026-10-01T10:00:00.000Z', attachmentUrl: 'https://github.com/o/r/blob/main/a.png?raw=true' },
    )
    expect(body).toContain('> Okno větví se nezavře Escapem.')
    expect(body).toContain('| Verze | 0.12.0 |')
    expect(body).toContain('| Prvek | tlačítko „Větve…“ · Pracovní plocha › Git |')
    expect(body).toContain('| Od | Michal Jašek <michal@example.com> |')
    expect(body).toContain('![snimek.png](https://github.com/o/r/blob/main/a.png?raw=true)')
    expect(body).toContain('abcd1234')
  })

  it('anonymně se neukáže jméno ani e-mail', () => {
    const body = issueBody({ ...feedback, author: null }, { id: 'x', receivedAt: 't', attachmentUrl: null })
    expect(body).toContain('| Od | anonymně |')
    expect(body).not.toContain('Michal')
  })

  it('svislítko v textu tabulku nerozbije', () => {
    const body = issueBody(
      { ...feedback, context: { ...feedback.context, location: 'a | b\nc' } },
      { id: 'x', receivedAt: 't', attachmentUrl: null },
    )
    expect(body).toContain('| Kde | a \\| b c |')
  })
})
