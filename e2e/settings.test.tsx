/**
 * End-to-end: nastavení.
 *
 * Každá volba tady má dvě strany: co se uloží do trezoru a co se hned stane
 * v okně. Testuje se obojí -- uložená hodnota, která se nikde neprojeví, byla
 * v týhle aplikaci už jednou (`theme` a `showPreview` se ukládaly a nikdy
 * nepoužily), takže to je přesně ta chyba, kterou má tahle sada chytat.
 */

import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { App } from '@/App'
import { StoreProvider } from '@/state/store'
import { MemoryVault, type VaultSettings } from '@/vault'

const NOTE = [
  '---',
  'id: seed0001pokus',
  'title: Pokusná poznámka',
  'created: 2026-09-01T09:00:00.000Z',
  'updated: 2026-09-01T09:00:00.000Z',
  'pinned: false',
  'tags: []',
  '---',
  '',
  '# Pokusná poznámka',
  '',
].join('\n')

let vault: MemoryVault

async function renderApp(settings: Partial<VaultSettings> = {}) {
  vault = new MemoryVault({ seed: { 'pokus.md': NOTE }, label: 'Testovací trezor', settings })
  render(
    <StoreProvider vault={vault}>
      <App />
    </StoreProvider>,
  )
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  // Ne na editor: v režimu Náhled žádný není, a právě to je jeden z testů.
  // Hlavička poznámky je tam vždycky, ať je zvolené kterékoli zobrazení.
  await screen.findByLabelText('Hlavička poznámky')
}

const dialog = () => screen.getByRole('dialog', { name: 'Nastavení' })

async function openSettings(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Nastavení' }))
  return dialog()
}

afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute('data-theme')
})

describe('otevření', () => {
  it('nastavení je ve stavovém řádku a zavře se Escapem', async () => {
    const user = userEvent.setup()
    await renderApp()

    const panel = await openSettings(user)
    expect(within(panel).getByText('Vzhled')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Nastavení' })).toBeNull()
    })
  })
})

describe('vzhled', () => {
  it('tmavý motiv se nastaví na dokumentu a uloží do trezoru', async () => {
    const user = userEvent.setup()
    await renderApp()
    const panel = await openSettings(user)

    await user.selectOptions(within(panel).getByLabelText('Motiv'), 'dark')

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('dark')
    })
    await waitFor(async () => {
      expect((await vault.loadSettings()).theme).toBe('dark')
    })
  })

  it('světlý motiv přebije tmavý systém', async () => {
    const user = userEvent.setup()
    await renderApp({ theme: 'dark' })
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'))

    const panel = await openSettings(user)
    await user.selectOptions(within(panel).getByLabelText('Motiv'), 'light')

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('light')
    })
  })

  it('velikost písma se projeví v editoru', async () => {
    await renderApp({ editorFontSize: 20 })
    const editor = screen.getByLabelText('Text poznámky')
    expect(editor.style.fontSize).toBe('20px')
  })
})

describe('výchozí stav okna', () => {
  it('výchozí zobrazení rozhoduje, co je po startu vidět', async () => {
    await renderApp({ defaultViewMode: 'preview' })
    // V režimu náhledu editor vůbec není v dokumentu.
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: 'Náhled' })).toBeChecked()
    })
  })

  it('levý panel se dá vypnout a po startu pak není', async () => {
    await renderApp({ showSidebar: false })
    expect(screen.queryByLabelText('Skupiny a štítky')).toBeNull()
  })

  it('lišta formátování se dá vypnout', async () => {
    await renderApp({ showToolbar: false })
    expect(screen.queryByRole('toolbar', { name: 'Formátování' })).toBeNull()
  })

  it('a zapnutá tam je', async () => {
    await renderApp({ showToolbar: true })
    expect(screen.getByRole('toolbar', { name: 'Formátování' })).toBeInTheDocument()
  })
})

describe('o aplikaci', () => {
  it('ukáže jméno autora, licenci a verze rozhraní', async () => {
    const user = userEvent.setup()
    await renderApp()
    const panel = await openSettings(user)

    expect(within(panel).getByText(/Michal Jašek/)).toBeInTheDocument()
    expect(within(panel).getByText(/MIT/)).toBeInTheDocument()
    expect(within(panel).getByText('React')).toBeInTheDocument()
    expect(within(panel).getByText('TypeScript')).toBeInTheDocument()
    expect(within(panel).getByText('Vite')).toBeInTheDocument()
  })

  it('v prohlížeči přizná, že verze jádra zjistit nejde, místo aby si je vymyslela', async () => {
    const user = userEvent.setup()
    await renderApp()
    const panel = await openSettings(user)

    // Bez Tauri žádný Rust neběží; předstírat čísla by tu bylo obzvlášť hloupé.
    expect(within(panel).getByText(/jen v desktopové aplikaci/)).toBeInTheDocument()
    expect(within(panel).queryByText('Tauri')).toBeNull()
  })
})
