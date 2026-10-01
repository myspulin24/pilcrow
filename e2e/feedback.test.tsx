/**
 * End-to-end: okno feedbacku.
 *
 * Jede proti `MemoryFeedback`, který si zapamatuje, co by Rust poslal na
 * Worker. Testuje se celá cesta v okně: otevření, ukázání na prvek (klik se
 * k aplikaci nedostane), příloha, druh, zpráva, anonymita, náhled toho, co
 * odejde, a odeslání i jeho selhání.
 */

import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { App } from '@/App'
import { MemoryFeedback, type MemoryFeedbackOptions } from '@/feedback'
import { StoreProvider } from '@/state/store'
import { MemoryVault, type VaultSettings } from '@/vault'

const NOTE = [
  '---',
  'id: seed0001pokus',
  'title: Tajný plán',
  'created: 2026-09-01T09:00:00.000Z',
  'updated: 2026-09-01T09:00:00.000Z',
  'pinned: false',
  'tags: []',
  '---',
  '',
  '# Tajný plán',
  '',
  'Text, který nikam odejít nesmí.',
  '',
].join('\n')

let vault: MemoryVault
let feedback: MemoryFeedback

type User = ReturnType<typeof userEvent.setup>

async function renderApp(options: MemoryFeedbackOptions = {}, settings: Partial<VaultSettings> = {}) {
  vault = new MemoryVault({ seed: { 'plan.md': NOTE }, label: 'Testovací trezor', settings })
  feedback = new MemoryFeedback(options)
  render(
    <StoreProvider vault={vault} feedback={feedback}>
      <App />
    </StoreProvider>,
  )
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  await screen.findByLabelText('Hlavička poznámky')
}

const dialog = () => screen.getByRole('dialog', { name: 'Poslat feedback' })

async function openFeedback(user: User) {
  await user.click(screen.getByRole('button', { name: 'Feedback' }))
  return screen.findByRole('dialog', { name: 'Poslat feedback' })
}

async function write(user: User, message: string, kind = 'Bug') {
  await user.click(within(dialog()).getByRole('radio', { name: new RegExp(kind) }))
  await user.type(within(dialog()).getByLabelText('Zpráva'), message)
}

afterEach(() => {
  cleanup()
})

describe('okno', () => {
  it('se otevře ze stavového řádku a samo zachytí, kde uživatel je', async () => {
    const user = userEvent.setup()
    await renderApp()
    const panel = await openFeedback(user)

    expect(
      within(panel).getByText('Poznámka v trezoru · zobrazení Obojí', { selector: '.feedback__context span' }),
    ).toBeInTheDocument()
    expect(await within(panel).findByText(/Pilcrow 0\.0\.0-test/)).toBeInTheDocument()
    // Bez druhu a textu odeslat nejde.
    expect(within(panel).getByRole('button', { name: 'Odeslat' })).toBeDisabled()
  })

  it('pošle druh, zprávu a kontext -- a nic z obsahu poznámky', async () => {
    const user = userEvent.setup()
    await renderApp({}, { feedbackName: 'Michal Jašek' })
    await openFeedback(user)
    await write(user, 'Okno větví se nezavře Escapem.', 'Bug')

    // Náhled ukáže přesně to, co odejde.
    await user.click(within(dialog()).getByText('Co přesně odejde'))
    expect(within(dialog()).getByText('Michal Jašek', { selector: 'dd' })).toBeVisible()
    await user.click(within(dialog()).getByRole('button', { name: 'Odeslat' }))

    expect(await within(dialog()).findByText('Díky! Feedback dorazil.')).toBeInTheDocument()
    expect(feedback.sent).toEqual([
      {
        kind: 'bug',
        message: 'Okno větví se nezavře Escapem.',
        location: 'Poznámka v trezoru · zobrazení Obojí',
        element: null,
        author: { name: 'Michal Jašek', email: '' },
        attachment: null,
      },
    ])
    const sent = JSON.stringify(feedback.sent)
    expect(sent).not.toContain('Tajný plán')
    expect(sent).not.toContain('nikam odejít')
    expect(sent).not.toContain('plan.md')
  })

  it('Ctrl+Enter odešle', async () => {
    const user = userEvent.setup()
    await renderApp()
    await openFeedback(user)
    await write(user, 'Tmavší okraj, prosím.', 'Vylepšení')
    await user.keyboard('{Control>}{Enter}{/Control}')
    await waitFor(() => expect(feedback.sent).toHaveLength(1))
    expect(feedback.sent[0]?.kind).toBe('improvement')
  })

  it('anonymně nepošle jméno ani e-mail a zapamatované jméno nepřepíše', async () => {
    const user = userEvent.setup()
    await renderApp({}, { feedbackName: 'Michal Jašek', feedbackEmail: 'michal@example.com' })
    await openFeedback(user)
    await write(user, 'Anonymní poznámka.', 'Změna')
    await user.click(within(dialog()).getByRole('checkbox', { name: /Poslat anonymně/ }))
    await user.click(within(dialog()).getByRole('button', { name: 'Odeslat' }))

    await waitFor(() => expect(feedback.sent).toHaveLength(1))
    expect(feedback.sent[0]?.author).toBeNull()
    expect((await vault.loadSettings()).feedbackName).toBe('Michal Jašek')
  })

  it('kdo se podepíše, toho si okno příště pamatuje', async () => {
    const user = userEvent.setup()
    await renderApp()
    await openFeedback(user)
    await user.click(within(dialog()).getByRole('button', { name: 'změnit' }))
    await user.type(within(dialog()).getByLabelText('Jméno'), 'Michal')
    await write(user, 'Ahoj.', 'Bug')
    await user.click(within(dialog()).getByRole('button', { name: 'Odeslat' }))

    await waitFor(async () => expect((await vault.loadSettings()).feedbackName).toBe('Michal'))
  })

  it('když odeslání selže, řekne to a text nechá v okně', async () => {
    const user = userEvent.setup()
    await renderApp({ fail: 'Feedbacku přišlo moc najednou. Zkus to za minutu.' })
    await openFeedback(user)
    await write(user, 'Zpráva, o kterou nechci přijít.')
    await user.click(within(dialog()).getByRole('button', { name: 'Odeslat' }))

    expect(await within(dialog()).findByRole('alert')).toHaveTextContent('moc najednou')
    expect(within(dialog()).getByLabelText('Zpráva')).toHaveValue('Zpráva, o kterou nechci přijít.')

    // Druhý pokus projde.
    feedback.fail = ''
    await user.click(within(dialog()).getByRole('button', { name: 'Odeslat' }))
    expect(await within(dialog()).findByText('Díky! Feedback dorazil.')).toBeInTheDocument()
  })

  it('rozepsaný text přežije zavření okna, po odeslání se začíná načisto', async () => {
    const user = userEvent.setup()
    await renderApp()
    await openFeedback(user)
    await write(user, 'Rozepsané')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Poslat feedback' })).toBeNull())

    await openFeedback(user)
    expect(within(dialog()).getByLabelText('Zpráva')).toHaveValue('Rozepsané')
    await user.click(within(dialog()).getByRole('button', { name: 'Odeslat' }))
    await within(dialog()).findByText('Díky! Feedback dorazil.')
    // Křížek nahoře i tlačítko pod poděkováním se jmenují stejně.
    await user.click(within(dialog()).getAllByRole('button', { name: 'Zavřít' }).at(-1)!)

    await openFeedback(user)
    expect(within(dialog()).getByLabelText('Zpráva')).toHaveValue('')
  })

  it('v prohlížeči přizná, že poslat nejde', async () => {
    const user = userEvent.setup()
    await renderApp({ available: false })
    await openFeedback(user)
    await write(user, 'Nepůjde to.')
    expect(await within(dialog()).findByRole('note')).toHaveTextContent('jen z desktopové aplikace')
    expect(within(dialog()).getByRole('button', { name: 'Odeslat' })).toBeDisabled()
  })
})

describe('označení prvku', () => {
  it('okno se schová, klik na prvek se k aplikaci nedostane a prvek se popíše', async () => {
    const user = userEvent.setup()
    await renderApp()
    await openFeedback(user)
    await user.click(within(dialog()).getByRole('button', { name: /Označit prvek v aplikaci/ }))

    expect(screen.queryByRole('dialog', { name: 'Poslat feedback' })).toBeNull()
    expect(screen.getByText(/Klikni na prvek/)).toBeInTheDocument()

    // Klik na „Nastavení“ nastavení neotevře -- jen ho označí.
    await user.click(screen.getByRole('button', { name: 'Nastavení' }))
    expect(screen.queryByRole('dialog', { name: 'Nastavení' })).toBeNull()

    const panel = await screen.findByRole('dialog', { name: 'Poslat feedback' })
    expect(within(panel).getByLabelText('Označený prvek')).toHaveTextContent('tlačítko „Nastavení“')

    await write(user, 'Tlačítko je moc malé.', 'Změna')
    await user.click(within(panel).getByRole('button', { name: 'Odeslat' }))
    await waitFor(() => expect(feedback.sent).toHaveLength(1))
    expect(feedback.sent[0]?.element?.label).toBe('tlačítko „Nastavení“')
    expect(feedback.sent[0]?.element?.path).toContain('button')
  })

  it('na editor ukázat jde, ale text poznámky se nevezme', async () => {
    const user = userEvent.setup()
    await renderApp()
    await openFeedback(user)
    await user.click(within(dialog()).getByRole('button', { name: /Označit prvek v aplikaci/ }))
    await user.click(screen.getByLabelText('Text poznámky'))

    const panel = await screen.findByRole('dialog', { name: 'Poslat feedback' })
    const element = within(panel).getByLabelText('Označený prvek')
    expect(element).toHaveTextContent('Text poznámky')
    expect(element).not.toHaveTextContent('nikam odejít')
  })

  it('Escape ukazování zruší a vrátí okno, jak bylo', async () => {
    const user = userEvent.setup()
    await renderApp()
    await openFeedback(user)
    await write(user, 'Rozepsáno')
    await user.click(within(dialog()).getByRole('button', { name: /Označit prvek v aplikaci/ }))
    await user.keyboard('{Escape}')

    const panel = await screen.findByRole('dialog', { name: 'Poslat feedback' })
    expect(within(panel).queryByLabelText('Označený prvek')).toBeNull()
    expect(within(panel).getByLabelText('Zpráva')).toHaveValue('Rozepsáno')
  })
})

describe('příloha', () => {
  it('soubor se přiloží a odejde v base64', async () => {
    const user = userEvent.setup()
    await renderApp()
    await openFeedback(user)
    await user.upload(within(dialog()).getByLabelText('Přidat soubor'), new File(['chyba v logu'], 'pilcrow.log', { type: 'text/plain' }))

    expect(await within(dialog()).findByText(/pilcrow\.log/, { selector: '.feedback__file span' })).toBeInTheDocument()
    await write(user, 'Log je přiložený.')
    await user.click(within(dialog()).getByRole('button', { name: 'Odeslat' }))

    await waitFor(() => expect(feedback.sent).toHaveLength(1))
    expect(feedback.sent[0]?.attachment).toEqual({
      name: 'pilcrow.log',
      type: 'text/plain',
      data: btoa('chyba v logu'),
    })
  })

  it('cizí typ a velký soubor odmítne a řekne proč', async () => {
    const user = userEvent.setup({ applyAccept: false })
    await renderApp()
    await openFeedback(user)
    await user.upload(within(dialog()).getByLabelText('Přidat soubor'), new File(['MZ'], 'program.exe'))
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent('se přiložit nedá')

    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'velky.png', { type: 'image/png' })
    await user.upload(within(dialog()).getByLabelText('Přidat soubor'), big)
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent('větší než 2 MB')
  })

  it('snímek ze schránky se přiloží vložením', async () => {
    const user = userEvent.setup()
    await renderApp()
    await openFeedback(user)
    within(dialog()).getByLabelText('Zpráva').focus()
    await user.paste({
      files: [new File(['png'], 'image.png', { type: 'image/png' })],
      items: [],
      types: ['Files'],
      getData: () => '',
    } as unknown as DataTransfer)
    expect(await within(dialog()).findByText(/image\.png/, { selector: '.feedback__file span' })).toBeInTheDocument()
  })
})
