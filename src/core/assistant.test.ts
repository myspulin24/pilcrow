import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_SYSTEM_PROMPT,
  CONTEXT_LIMIT,
  appendDelta,
  awaitsLoginCode,
  buildQuestion,
  createLineSplitter,
  failMessage,
  findLoginUrl,
  finishMessage,
  parseAssistantLine,
  parseAuthStatus,
  setupStep,
  ASSISTANT_MODELS,
  LEGACY_ASSISTANT_MODELS,
  assistantModelLabel,
  type AssistantMessage,
  type AssistantProbe,
} from './assistant'

/** Řádek, jaký opravdu vypisuje `claude --output-format stream-json`. */
function delta(text: string): string {
  return JSON.stringify({
    type: 'stream_event',
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text } },
  })
}

describe('parseAssistantLine', () => {
  it('vytáhne přírůstek textu', () => {
    expect(parseAssistantLine(delta('ahoj'))).toEqual({ type: 'delta', text: 'ahoj' })
  })

  it('přečte závěrečný výsledek i s číslem sezení', () => {
    const line = JSON.stringify({
      type: 'result',
      is_error: false,
      result: 'Ahoj světe',
      session_id: 'abc-123',
      total_cost_usd: 0.0042,
    })
    expect(parseAssistantLine(line)).toEqual({
      type: 'done',
      sessionId: 'abc-123',
      text: 'Ahoj světe',
      costUsd: 0.0042,
    })
  })

  it('pozná odmítnutí, které přišlo jako výsledek', () => {
    const line = JSON.stringify({
      type: 'result',
      is_error: true,
      result: 'Not logged in · Please run /login',
    })
    expect(parseAssistantLine(line)).toEqual({
      type: 'error',
      message: 'Not logged in · Please run /login',
    })
  })

  it('mlčky přeskočí, čemu nerozumí', () => {
    const ignored = [
      '',
      '   ',
      'tohle není JSON',
      '{"neuzavřený',
      'null',
      '42',
      JSON.stringify({ type: 'system', subtype: 'init' }),
      JSON.stringify({ type: 'rate_limit_event' }),
      JSON.stringify({ type: 'stream_event', event: { type: 'content_block_start' } }),
      // Přírůstek myšlení není odpověď a do panelu nepatří.
      JSON.stringify({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hm' } },
      }),
    ]
    for (const line of ignored) {
      expect(parseAssistantLine(line), line).toEqual({ type: 'ignored' })
    }
  })

  it('unese chybějící session_id i cenu', () => {
    const line = JSON.stringify({ type: 'result', is_error: false, result: 'a' })
    expect(parseAssistantLine(line)).toEqual({
      type: 'done',
      sessionId: null,
      text: 'a',
      costUsd: null,
    })
  })
})

describe('createLineSplitter', () => {
  it('spojí řádek rozseknutý mezi dvěma kousky', () => {
    const split = createLineSplitter()
    expect(split('{"a":')).toEqual([])
    expect(split('1}\n')).toEqual(['{"a":1}'])
  })

  it('vrátí víc řádků z jednoho kousku', () => {
    const split = createLineSplitter()
    expect(split('a\nb\nc')).toEqual(['a', 'b'])
    expect(split('\n')).toEqual(['c'])
  })

  it('zahodí windowsový návrat vozíku, i když přijde na hraně kousků', () => {
    const split = createLineSplitter()
    expect(split('první\r')).toEqual([])
    expect(split('\ndruhý\r\n')).toEqual(['první', 'druhý'])
  })

  it('nedopsaný konec drží, dokud nepřijde odřádkování', () => {
    const split = createLineSplitter()
    expect(split('Paste code here if prompted > ')).toEqual([])
  })
})

describe('parseAuthStatus', () => {
  it('přečte skutečný výstup `claude auth status --json`', () => {
    const raw = JSON.stringify({
      loggedIn: true,
      authMethod: 'claude.ai',
      apiProvider: 'firstParty',
      email: 'kdo@příklad.cz',
      orgName: 'BR Group',
      subscriptionType: 'team',
    })
    expect(parseAuthStatus(raw)).toEqual({
      loggedIn: true,
      email: 'kdo@příklad.cz',
      method: 'claude.ai',
      plan: 'team',
      organisation: 'BR Group',
    })
  })

  it('chybějící pole nejsou chyba, jen prázdno', () => {
    expect(parseAuthStatus('{"loggedIn":false}')).toEqual({
      loggedIn: false,
      email: '',
      method: '',
      plan: '',
      organisation: '',
    })
  })

  it('vrátí null, když nepřišlo nic použitelného', () => {
    for (const raw of ['', '   ', 'not json', 'null', '[]', '"text"']) {
      expect(parseAuthStatus(raw), raw).toBeNull()
    }
  })
})

describe('setupStep', () => {
  const probe = (patch: Partial<AssistantProbe> = {}): AssistantProbe => ({
    installed: true,
    version: '2.1.0',
    path: 'claude',
    auth: JSON.stringify({ loggedIn: true }),
    error: '',
    ...patch,
  })

  it('v prohlížeči nenabízí nic', () => {
    expect(setupStep(probe(), false)).toBe('unsupported')
    expect(setupStep(null, false)).toBe('unsupported')
  })

  it('bez zjištěného stavu začíná instalací', () => {
    expect(setupStep(null, true)).toBe('install')
    expect(setupStep(probe({ installed: false }), true)).toBe('install')
  })

  it('nainstalováno, ale nepřihlášeno, znamená přihlášení', () => {
    expect(setupStep(probe({ auth: '' }), true)).toBe('login')
    expect(setupStep(probe({ auth: '{"loggedIn":false}' }), true)).toBe('login')
  })

  it('přihlášeno znamená hotovo', () => {
    expect(setupStep(probe(), true)).toBe('ready')
  })
})

describe('findLoginUrl', () => {
  it('najde adresu ve výstupu přihlašování', () => {
    const transcript = [
      'Opening browser to sign in…',
      'If the browser didn\'t open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c',
      'Paste code here if prompted > ',
    ].join('\n')
    expect(findLoginUrl(transcript)).toBe(
      'https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c',
    )
  })

  it('neplete si adresu s tečkou na konci věty', () => {
    expect(findLoginUrl('Jdi na https://claude.com/login.')).toBe('https://claude.com/login')
  })

  it('vrátí null, dokud adresa nedorazila', () => {
    expect(findLoginUrl('Opening browser to sign in…')).toBeNull()
  })
})

describe('awaitsLoginCode', () => {
  it('pozná výzvu k vložení kódu', () => {
    expect(awaitsLoginCode('Paste code here if prompted > ')).toBe(true)
  })

  it('nehlásí ji předčasně', () => {
    expect(awaitsLoginCode('Opening browser to sign in…')).toBe(false)
  })
})

describe('buildQuestion', () => {
  it('obalí poznámku značkami a připojí otázku', () => {
    const { prompt, truncated } = buildQuestion({
      note: '# Rozpočet\n\nNa jaře 120 tisíc.',
      title: 'Rozpočet',
      question: '  Kolik je na jaře?  ',
    })
    expect(truncated).toBe(false)
    expect(prompt).toBe(
      '<poznámka název="Rozpočet">\n# Rozpočet\n\nNa jaře 120 tisíc.\n</poznámka>\n\nKolik je na jaře?',
    )
  })

  it('uvozovky v názvu nerozbijí značku', () => {
    const { prompt } = buildQuestion({ note: '', title: 'Cituji "tohle"', question: 'co?' })
    expect(prompt.startsWith("<poznámka název=\"Cituji 'tohle'\">")).toBe(true)
  })

  it('dlouhou poznámku ořízne a řekne to', () => {
    const { prompt, truncated } = buildQuestion({
      note: 'a'.repeat(CONTEXT_LIMIT + 500),
      title: 'Dlouhá',
      question: 'co?',
    })
    expect(truncated).toBe(true)
    expect(prompt).toContain('zbytek se neposlal')
    // Odeslalo se přesně tolik, kolik je povolený strop, ne víc.
    expect(prompt.split('\n')[1]).toHaveLength(CONTEXT_LIMIT)
  })

  it('poznámka přesně na hraně se ještě vejde celá', () => {
    const { truncated } = buildQuestion({
      note: 'a'.repeat(CONTEXT_LIMIT),
      title: 'Přesně',
      question: 'co?',
    })
    expect(truncated).toBe(false)
  })
})

describe('ASSISTANT_SYSTEM_PROMPT', () => {
  it('říká Claudovi, ať si nedomýšlí a odpovídá česky', () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('česky')
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('Nedomýšlej')
  })
})

describe('skládání zpráv', () => {
  const user: AssistantMessage = { role: 'user', text: 'Kolik?' }

  it('první přírůstek založí rozepsanou odpověď', () => {
    expect(appendDelta([user], 'Sto')).toEqual([
      user,
      { role: 'assistant', text: 'Sto', streaming: true },
    ])
  })

  it('další přírůstky se přilepí k té stejné', () => {
    let messages = appendDelta([user], 'Sto')
    messages = appendDelta(messages, ' dvacet')
    expect(messages).toHaveLength(2)
    expect(messages[1]?.text).toBe('Sto dvacet')
  })

  it('nepřilepí se k odpovědi, která je už dopsaná', () => {
    const done: AssistantMessage[] = [user, { role: 'assistant', text: 'Hotovo' }]
    expect(appendDelta(done, 'další')).toHaveLength(3)
  })

  it('závěrečný text vyhraje, když je delší než posbírané přírůstky', () => {
    const messages = appendDelta([user], 'Sto')
    const finished = finishMessage(messages, 'Sto dvacet tisíc.')
    expect(finished[1]).toEqual({ role: 'assistant', text: 'Sto dvacet tisíc.' })
  })

  it('kratší závěrečný text posbírané přírůstky nezahodí', () => {
    const messages = appendDelta([user], 'Sto dvacet tisíc.')
    expect(finishMessage(messages, '')[1]?.text).toBe('Sto dvacet tisíc.')
  })

  it('žádné pole se nemění na místě', () => {
    const original: AssistantMessage[] = [user]
    appendDelta(original, 'x')
    finishMessage(original, 'x')
    failMessage(original, 'x')
    expect(original).toEqual([user])
  })

  it('chyba označí rozepsanou odpověď a nechá, co už došlo', () => {
    const messages = appendDelta([user], 'Sto')
    const failed = failMessage(messages, 'Spadlo to.')
    expect(failed[1]).toEqual({
      role: 'assistant',
      text: 'Sto',
      streaming: false,
      error: 'Spadlo to.',
    })
  })

  it('chyba bez rozepsané odpovědi přidá vlastní řádek', () => {
    expect(failMessage([user], 'Spadlo to.')).toEqual([
      user,
      { role: 'assistant', text: '', error: 'Spadlo to.' },
    ])
  })
})

describe('nabídka modelů', () => {
  it('nabízí jména, která `claude --model` zná', () => {
    // Přesně ta, která má ve svém katalogu Claude Code na tomhle počítači.
    expect(ASSISTANT_MODELS.map((model) => model.id)).toEqual([
      'claude-opus-5',
      'claude-fable-5-1',
      'claude-sonnet-5',
    ])
    expect(LEGACY_ASSISTANT_MODELS.map((model) => model.id)).toEqual([
      'claude-opus-4-8',
      'claude-haiku-4-5',
    ])
  })

  it('žádné jméno se neopakuje a všechna vypadají jako jméno modelu', () => {
    const ids = [...ASSISTANT_MODELS, ...LEGACY_ASSISTANT_MODELS].map((model) => model.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^claude-[a-z0-9-]+$/)
  })

  it('pojmenuje model pro UI a neznámý nechá tak, jak je uložený', () => {
    expect(assistantModelLabel('claude-opus-5')).toBe('Claude Opus 5')
    expect(assistantModelLabel('claude-haiku-4-5')).toBe('Claude Haiku 4.5')
    // Volba z novější verze Claude Code, o které tenhle seznam neví.
    expect(assistantModelLabel('claude-opus-6')).toBe('claude-opus-6')
    expect(assistantModelLabel('')).toBe('')
  })
})
