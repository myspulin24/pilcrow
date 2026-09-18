/**
 * End-to-end: rozhovor s Claudem nad poznámkou.
 *
 * Jede proti `MemoryAssistant`, který drží stejná pravidla jako ta skutečná
 * implementace: dokud není nainstalováno, nejde se přihlásit; dokud není
 * přihlášeno, nejde se ptát; a odpověď chodí ve stejném formátu, jaký vypisuje
 * `claude --output-format stream-json`.
 *
 * Co se tady otestovat nedá, je spuštění procesu a klíčenka systému. Všechno
 * ostatní -- souhlas, příprava, kontext, streamování -- ano.
 */

import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { App } from '@/App'
import { MemoryAssistant, type MemoryAssistantOptions } from '@/assistant'
import { StoreProvider } from '@/state/store'
import { MemoryVault } from '@/vault'

const VAULT_NOTE = [
  '---',
  'id: seed0001vault',
  'title: Rozpočet výpravy',
  'created: 2026-09-01T09:00:00.000Z',
  'updated: 2026-09-01T09:00:00.000Z',
  'pinned: false',
  'tags: []',
  '---',
  '',
  '# Rozpočet výpravy',
  '',
  'Na jaře 120 tisíc, na podzim nic.',
  '',
].join('\n')

let vault: MemoryVault
let assistant: MemoryAssistant

async function renderApp(options: MemoryAssistantOptions = {}) {
  vault = new MemoryVault({ seed: { 'rozpocet-vypravy.md': VAULT_NOTE }, label: 'Testovací trezor' })
  assistant = new MemoryAssistant(options)

  render(
    <StoreProvider vault={vault} assistant={assistant}>
      <App />
    </StoreProvider>,
  )
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return assistant
}

const panel = () => screen.getByRole('complementary', { name: 'Claude' })

async function openPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Claude' }))
  return panel()
}

afterEach(() => {
  cleanup()
})

describe('souhlas', () => {
  it('panel je zavřený, dokud se neklikne', async () => {
    await renderApp()
    expect(screen.queryByRole('complementary', { name: 'Claude' })).toBeNull()
  })

  it('nejdřív řekne, co odchází z počítače, a teprve pak nabídne cokoli dalšího', async () => {
    const user = userEvent.setup()
    await renderApp()
    const aside = await openPanel(user)

    expect(within(aside).getByText(/odejdou k Anthropicu/i)).toBeTruthy()
    // Žádné pole na otázku, dokud uživatel nesouhlasil.
    expect(within(aside).queryByPlaceholderText(/Zeptej se/i)).toBeNull()
  })

  it('zapnutí se uloží do nastavení trezoru, takže přežije restart', async () => {
    const user = userEvent.setup()
    await renderApp()
    const aside = await openPanel(user)

    expect((await vault.loadSettings()).assistantEnabled).toBe(false)
    await user.click(within(aside).getByRole('button', { name: 'Zapnout asistenta' }))

    await waitFor(async () => {
      expect((await vault.loadSettings()).assistantEnabled).toBe(true)
    })
  })
})

describe('příprava', () => {
  async function enable(user: ReturnType<typeof userEvent.setup>) {
    const aside = await openPanel(user)
    await user.click(within(aside).getByRole('button', { name: 'Zapnout asistenta' }))
    return aside
  }

  it('bez Claude Code nabídne instalaci a ukáže, co přesně spustí', async () => {
    const user = userEvent.setup()
    await renderApp({ installed: false })
    const aside = await enable(user)

    await waitFor(() => {
      expect(within(aside).getByText('Claude Code není nainstalovaný')).toBeTruthy()
    })
    // Příkaz musí být vidět dřív, než se na cokoli klikne: stahuje a spouští
    // skript z internetu a to se nedělá potichu.
    expect(within(aside).getByText(/install\.ps1/)).toBeTruthy()
    expect(within(aside).queryByRole('button', { name: 'Přihlásit se ke Claude' })).toBeNull()
  })

  it('po instalaci se sám posune k přihlášení', async () => {
    const user = userEvent.setup()
    await renderApp({ installed: false, loggedIn: false })
    const aside = await enable(user)

    await waitFor(() => within(aside).getByRole('button', { name: 'Nainstalovat Claude Code' }))
    await user.click(within(aside).getByRole('button', { name: 'Nainstalovat Claude Code' }))

    await waitFor(() => {
      expect(within(aside).getByText('Nejsi přihlášený')).toBeTruthy()
    })
  })

  it('neúspěšná instalace to řekne a nikam se neposune', async () => {
    const user = userEvent.setup()
    await renderApp({ installed: false, failInstall: 'Nedá se stáhnout: bez internetu.' })
    const aside = await enable(user)

    await waitFor(() => within(aside).getByRole('button', { name: 'Nainstalovat Claude Code' }))
    await user.click(within(aside).getByRole('button', { name: 'Nainstalovat Claude Code' }))

    await waitFor(() => {
      expect(within(aside).getByRole('alert').textContent).toContain('bez internetu')
    })
    expect(within(aside).getByText('Claude Code není nainstalovaný')).toBeTruthy()
  })

  it('přihlášení ukáže adresu, vezme kód a skončí přihlášeným účtem', async () => {
    const user = userEvent.setup()
    await renderApp({ loggedIn: false, code: '1234', email: 'ja@příklad.cz', plan: 'max' })
    const aside = await enable(user)

    await waitFor(() => within(aside).getByRole('button', { name: 'Přihlásit se ke Claude' }))
    await user.click(within(aside).getByRole('button', { name: 'Přihlásit se ke Claude' }))

    // Adresa je vidět celá: podepsat se dá jen tomu, co je vidět.
    const link = await within(aside).findByRole('link')
    expect(link.getAttribute('href')).toMatch(/^https:\/\/claude\.com\//)

    await user.type(within(aside).getByLabelText('Kód z prohlížeče'), '1234')
    await user.click(within(aside).getByRole('button', { name: 'Potvrdit kód' }))

    await waitFor(() => {
      expect(within(aside).getByText(/Přihlášen jako ja@příklad.cz/)).toBeTruthy()
    })
    expect(within(aside).getByText(/předplatné max/)).toBeTruthy()
  })

  it('špatný kód nepřihlásí a řekne proč', async () => {
    const user = userEvent.setup()
    await renderApp({ loggedIn: false, code: '1234' })
    const aside = await enable(user)

    await waitFor(() => within(aside).getByRole('button', { name: 'Přihlásit se ke Claude' }))
    await user.click(within(aside).getByRole('button', { name: 'Přihlásit se ke Claude' }))
    await within(aside).findByRole('link')

    await user.type(within(aside).getByLabelText('Kód z prohlížeče'), '0000')
    await user.click(within(aside).getByRole('button', { name: 'Potvrdit kód' }))

    await waitFor(() => {
      expect(within(aside).getByRole('alert').textContent).toContain('Kód nesedí')
    })
    expect(within(aside).queryByText(/Přihlášen jako/)).toBeNull()
  })
})

describe('rozhovor', () => {
  async function ready(user: ReturnType<typeof userEvent.setup>, options: MemoryAssistantOptions = {}) {
    await renderApp(options)
    const aside = await openPanel(user)
    await user.click(within(aside).getByRole('button', { name: 'Zapnout asistenta' }))
    await waitFor(() => within(aside).getByPlaceholderText(/Zeptej se/i))
    return aside
  }

  it('kontextem je otevřená poznámka a je to vidět', async () => {
    const user = userEvent.setup()
    const aside = await ready(user)
    expect(within(aside).getByText('Kontext: Rozpočet výpravy')).toBeTruthy()
  })

  it('otázka projde ven i s textem poznámky, odpověď se skládá po kouscích', async () => {
    const user = userEvent.setup()
    let sent = ''
    const aside = await ready(user, {
      reply: 'Na jaře je 120 tisíc.',
      // Zachytíme, co se doopravdy odesílá. Tohle je to jediné, co opouští
      // počítač, takže to má test hlídat výslovně.
    })
    const original = assistant.ask.bind(assistant)
    assistant.ask = async (input, sink) => {
      sent = input.prompt
      return original(input, sink)
    }

    await user.type(within(aside).getByPlaceholderText(/Zeptej se/i), 'Kolik je na jaře?')
    await user.click(within(aside).getByRole('button', { name: 'Odeslat' }))

    await waitFor(() => {
      expect(within(aside).getByText(/Na jaře je 120 tisíc/)).toBeTruthy()
    })

    expect(sent).toContain('<poznámka název="Rozpočet výpravy">')
    expect(sent).toContain('Na jaře 120 tisíc, na podzim nic.')
    expect(sent).toContain('Kolik je na jaře?')
    // Jiné poznámky ani cesty k souborům se neposílají.
    expect(sent).not.toContain('.md')
  })

  it('otázka i odpověď zůstanou v panelu vedle sebe', async () => {
    const user = userEvent.setup()
    const aside = await ready(user, { reply: 'Sto dvacet tisíc.' })

    await user.type(within(aside).getByPlaceholderText(/Zeptej se/i), 'Kolik?')
    await user.click(within(aside).getByRole('button', { name: 'Odeslat' }))

    await waitFor(() => within(aside).getByText('Sto dvacet tisíc.'))
    expect(within(aside).getByText('Kolik?')).toBeTruthy()
  })

  it('selhání se ukáže u odpovědi, ne jako prázdno', async () => {
    const user = userEvent.setup()
    const aside = await ready(user, { failAsk: 'Došel limit předplatného.' })

    await user.type(within(aside).getByPlaceholderText(/Zeptej se/i), 'Kolik?')
    await user.click(within(aside).getByRole('button', { name: 'Odeslat' }))

    await waitFor(() => {
      expect(within(aside).getByRole('alert').textContent).toContain('Došel limit')
    })
  })

  it('nový rozhovor smaže historii', async () => {
    const user = userEvent.setup()
    const aside = await ready(user, { reply: 'Ano.' })

    await user.type(within(aside).getByPlaceholderText(/Zeptej se/i), 'Je to tak?')
    await user.click(within(aside).getByRole('button', { name: 'Odeslat' }))
    await waitFor(() => within(aside).getByText('Ano.'))

    await user.click(within(aside).getByRole('button', { name: 'Nový rozhovor' }))
    expect(within(aside).queryByText('Ano.')).toBeNull()
  })

  it('vypnutí zahodí rozhovor a vrátí souhlas', async () => {
    const user = userEvent.setup()
    const aside = await ready(user, { reply: 'Ano.' })

    await user.type(within(aside).getByPlaceholderText(/Zeptej se/i), 'Je to tak?')
    await user.click(within(aside).getByRole('button', { name: 'Odeslat' }))
    await waitFor(() => within(aside).getByText('Ano.'))

    await user.click(within(aside).getByRole('button', { name: 'Vypnout asistenta' }))

    await waitFor(() => {
      expect(within(aside).getByText(/odejdou k Anthropicu/i)).toBeTruthy()
    })
    expect(within(aside).queryByText('Ano.')).toBeNull()
  })
})

describe('v prohlížeči', () => {
  it('neslibuje něco, co tam nejde spustit, a nenabízí ani přepínač', async () => {
    const user = userEvent.setup()
    await renderApp({ available: false })
    const aside = await openPanel(user)

    expect(within(aside).getByText('Asistent funguje jen v desktopové aplikaci.')).toBeTruthy()
    // Souhlas s odesíláním poznámek dává smysl jen tam, kde se dá něco odeslat.
    expect(within(aside).queryByRole('button', { name: 'Zapnout asistenta' })).toBeNull()
  })
})
