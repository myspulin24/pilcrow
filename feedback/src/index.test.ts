import { describe, expect, it } from 'vitest'

import { handle, type Deps, type Env } from './index'

const env: Env = { GITHUB_TOKEN: 'tajne', GITHUB_REPO: 'o/feedback' }

const body = {
  kind: 'change',
  message: 'Chci tmavší okraj.',
  context: { version: '0.12.0', os: 'windows (x86_64)', location: 'Poznámka v trezoru', element: null },
  author: null,
  attachment: null,
}

function post(payload: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://feedback.example/v1/feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-pilcrow-version': '0.12.0', ...headers },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  })
}

/** Podvržený GitHub: zapamatuje si volání a odpoví, jak se mu řekne. */
function fakeGithub(respond: (url: string, init: RequestInit) => Response = () => Response.json({ number: 7 }, { status: 201 })) {
  const calls: Array<{ url: string; method: string; body: Record<string, unknown>; auth: string | null }> = []
  const deps: Deps = {
    fetch: async (input, init = {}) => {
      const url = String(input)
      calls.push({
        url,
        method: init.method ?? 'GET',
        body: JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>,
        auth: new Headers(init.headers).get('authorization'),
      })
      return respond(url, init)
    },
    now: () => new Date('2026-10-01T10:00:00Z'),
    id: () => 'abcd1234',
  }
  return { calls, deps }
}

describe('obsluha', () => {
  it('založí issue v nastaveném repu se štítkem podle druhu', async () => {
    const { calls, deps } = fakeGithub()
    const response = await handle(post(body), env, deps)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, id: 'abcd1234', number: 7 })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://api.github.com/repos/o/feedback/issues')
    expect(calls[0]?.auth).toBe('Bearer tajne')
    expect(calls[0]?.body.title).toBe('[Změna] Chci tmavší okraj.')
    expect(calls[0]?.body.labels).toEqual(['změna'])
  })

  it('přílohu napřed uloží do repa a issue na ni odkáže', async () => {
    const { calls, deps } = fakeGithub((url) =>
      url.includes('/contents/')
        ? Response.json({ content: { html_url: 'https://github.com/o/feedback/blob/main/attachments/2026/10/abcd1234-log.txt' } }, { status: 201 })
        : Response.json({ number: 8 }, { status: 201 }),
    )
    const attachment = { name: 'můj log.txt', type: 'text/plain', data: btoa('chyba') }
    const response = await handle(post({ ...body, attachment }), env, deps)

    expect(response.status).toBe(200)
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'PUT https://api.github.com/repos/o/feedback/contents/attachments/2026/10/abcd1234-muj-log.txt',
      'POST https://api.github.com/repos/o/feedback/issues',
    ])
    expect(calls[0]?.body.content).toBe(btoa('chyba'))
    expect(String(calls[1]?.body.body)).toContain('[můj log.txt](https://github.com/o/feedback/blob/main/attachments/2026/10/abcd1234-log.txt?raw=true)')
  })

  it('neplatný feedback odmítne dřív, než sáhne na GitHub', async () => {
    const { calls, deps } = fakeGithub()
    const response = await handle(post({ ...body, message: '' }), env, deps)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ ok: false, error: 'Zpráva je prázdná.' })
    expect(calls).toHaveLength(0)

    expect((await handle(post('{nesmysl'), env, deps)).status).toBe(400)
  })

  it('bez hlavičky aplikace, jinak než JSONem nebo moc velké se nepřijme', async () => {
    const { calls, deps } = fakeGithub()
    expect((await handle(post(body, { 'x-pilcrow-version': '' }), env, deps)).status).toBe(400)
    expect((await handle(post(body, { 'content-type': 'text/plain' }), env, deps)).status).toBe(415)
    expect((await handle(post(body, { 'content-length': '99999999' }), env, deps)).status).toBe(413)
    expect(calls).toHaveLength(0)
  })

  it('omezí počet odeslání z jedné adresy', async () => {
    const { deps } = fakeGithub()
    const keys: string[] = []
    const limited: Env = {
      ...env,
      LIMITER: { limit: async ({ key }) => (keys.push(key), { success: keys.length <= 1 }) },
    }
    const first = await handle(post(body, { 'cf-connecting-ip': '1.2.3.4' }), limited, deps)
    const second = await handle(post(body, { 'cf-connecting-ip': '1.2.3.4' }), limited, deps)
    expect(first.status).toBe(200)
    expect(second.status).toBe(429)
    expect(keys).toEqual(['1.2.3.4', '1.2.3.4'])
  })

  it('selhání GitHubu ohlásí obecně -- podrobnosti jdou do logu, ne odesílateli', async () => {
    const { deps } = fakeGithub(() => new Response('{"message":"Bad credentials"}', { status: 401 }))
    const errors: string[] = []
    const original = console.error
    console.error = (message: string) => errors.push(message)
    try {
      const response = await handle(post(body), env, deps)
      expect(response.status).toBe(502)
      expect(JSON.stringify(await response.json())).not.toContain('credentials')
      expect(errors.join('\n')).toContain('Bad credentials')
    } finally {
      console.error = original
    }
  })

  it('bez tokenu přizná, že příjem není nastavený', async () => {
    const { deps } = fakeGithub()
    const response = await handle(post(body), { GITHUB_REPO: 'o/feedback' }, deps)
    expect(response.status).toBe(503)
  })

  it('na kořeni odpoví, že žije; jinde nic není', async () => {
    expect(await (await handle(new Request('https://feedback.example/'), env)).text()).toBe('pilcrow-feedback\n')
    expect((await handle(new Request('https://feedback.example/jinam'), env)).status).toBe(404)
    expect((await handle(new Request('https://feedback.example/v1/feedback'), env)).status).toBe(405)
  })
})
