import { describe, expect, it } from 'vitest'

import {
  checkAttachment,
  draftProblem,
  EMPTY_DRAFT,
  feedbackLocation,
  feedbackRequest,
  formatFileSize,
  type FeedbackDraft,
} from './feedback'

const draft = (patch: Partial<FeedbackDraft> = {}): FeedbackDraft => ({
  ...EMPTY_DRAFT,
  kind: 'bug',
  message: 'Nejde to.',
  ...patch,
})

describe('příloha', () => {
  it('typ podle přípony, ne podle toho, co tvrdí systém', () => {
    expect(checkAttachment('snimek.PNG', 1000)).toEqual({ ok: true, type: 'image/png' })
    expect(checkAttachment('log.txt', 1000)).toEqual({ ok: true, type: 'text/plain' })
    expect(checkAttachment('data.json', 1000)).toEqual({ ok: true, type: 'application/json' })
    expect(checkAttachment('program.exe', 1000)).toEqual({ ok: false, reason: 'type' })
    expect(checkAttachment('bez-pripony', 10)).toEqual({ ok: false, reason: 'type' })
  })

  it('nejvýš 2 MB', () => {
    expect(checkAttachment('a.png', 2 * 1024 * 1024).ok).toBe(true)
    expect(checkAttachment('a.png', 2 * 1024 * 1024 + 1)).toEqual({ ok: false, reason: 'size' })
  })

  it('velikost lidsky', () => {
    expect(formatFileSize(500)).toBe('500 B')
    expect(formatFileSize(48_153)).toBe('47 kB')
    expect(formatFileSize(1_600_000)).toBe('1,5 MB')
  })
})

describe('kde uživatel je', () => {
  const facts = {
    open: 'note' as const,
    viewMode: 'split' as const,
    sidebarVisible: true,
    openFolders: 0,
    gitReady: false,
    assistantOpen: false,
  }

  it('jen druh věcí, bez názvů', () => {
    expect(feedbackLocation(facts)).toBe('Poznámka v trezoru · zobrazení Obojí')
    expect(
      feedbackLocation({ ...facts, open: 'file', viewMode: 'preview', sidebarVisible: false, openFolders: 2, gitReady: true }),
    ).toBe('Soubor ze složky · zobrazení Náhled · levý panel skrytý · otevřené složky: 2 · Git')
    expect(feedbackLocation({ ...facts, open: 'none', openFolders: 1, assistantOpen: true })).toBe(
      'Nic otevřeného · 1 otevřená složka · panel asistenta',
    )
  })
})

describe('koncept a zpráva', () => {
  it('co chybí, než se dá odeslat', () => {
    expect(draftProblem(draft())).toBeNull()
    expect(draftProblem(draft({ kind: null }))).toBe('kind')
    expect(draftProblem(draft({ message: '   ' }))).toBe('message')
    expect(draftProblem(draft({ message: 'x'.repeat(10_001) }))).toBe('too-long')
    expect(draftProblem(draft({ email: 'neni-email' }))).toBe('email')
    // Anonymně se e-mail neposílá, takže na něm nezáleží.
    expect(draftProblem(draft({ email: 'neni-email', anonymous: true }))).toBeNull()
  })

  it('anonymně znamená bez jména i bez e-mailu', () => {
    const signed = feedbackRequest(draft({ name: ' Michal ', email: 'm@example.com' }), 'Kde')
    expect(signed.author).toEqual({ name: 'Michal', email: 'm@example.com' })
    expect(feedbackRequest(draft({ name: 'Michal', email: 'm@example.com', anonymous: true }), 'Kde').author).toBeNull()
    expect(feedbackRequest(draft({ name: ' ', email: '' }), 'Kde').author).toBeNull()
  })

  it('příloha odejde bez velikosti -- ta je jen pro okno', () => {
    const request = feedbackRequest(
      draft({ file: { name: 'a.png', type: 'image/png', size: 3, data: 'AAAA' } }),
      'Poznámka v trezoru',
    )
    expect(request.attachment).toEqual({ name: 'a.png', type: 'image/png', data: 'AAAA' })
    expect(request.location).toBe('Poznámka v trezoru')
    expect(request.message).toBe('Nejde to.')
  })
})
