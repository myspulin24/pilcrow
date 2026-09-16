/**
 * End-to-end: aktualizace z GitHub Releases.
 *
 * Jede proti `MemoryUpdater`, který drží stejná pravidla jako ten skutečný
 * (jen novější verze, instalovat jde jen stažené). Podpis balíčku ověřuje
 * plugin Tauri veřejným klíčem z `tauri.conf.json` -- to je jediný kus, který
 * se tady otestovat nedá a který stojí a padá s tím, že soukromý klíč zůstane
 * mimo repozitář.
 */

import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { App } from '@/App'
import { StoreProvider } from '@/state/store'
import { MemoryUpdater, type MemoryUpdaterOptions } from '@/updater'
import { MemoryVault } from '@/vault'

const VAULT_NOTE = [
  '---',
  'id: seed0001vault',
  'title: Poznámka z trezoru',
  'created: 2026-09-01T09:00:00.000Z',
  'updated: 2026-09-01T09:00:00.000Z',
  'pinned: false',
  'tags: []',
  '---',
  '',
  '# Poznámka z trezoru',
  '',
  'Je v trezoru.',
  '',
].join('\n')

let vault: MemoryVault
let updater: MemoryUpdater

async function renderApp(options: MemoryUpdaterOptions = {}) {
  vault = new MemoryVault({ seed: { 'poznamka-z-trezoru.md': VAULT_NOTE }, label: 'Testovací trezor' })
  updater = new MemoryUpdater({ currentVersion: '0.1.0', chunks: 3, ...options })

  render(
    <StoreProvider vault={vault} updater={updater}>
      <App />
    </StoreProvider>,
  )
  // Start běží asynchronně: stav trezoru -> nastavení -> seznam -> kontrola
  // aktualizací. Necháme celý řetěz doběhnout uvnitř act().
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return updater
}

const dialog = () => screen.getByRole('dialog', { name: /nová verze|připravená|nepovedla/i })

afterEach(() => {
  cleanup()
})

describe('kontrola po startu', () => {
  it('najde novou verzi, stáhne ji sama a nabídne restart', async () => {
    const user = userEvent.setup()
    await renderApp({
      latest: { version: '0.2.0', notes: '## Novinky\n\n- Rychlejší hledání\n- Opravené štítky' },
    })

    // Okno se otevře samo -- tohle je jediná věc, kterou aplikace udělá bez
    // vyzvání, a proto stojí za test. Stahování běží taky bez kliknutí, takže
    // než se test podívá, je nabídka rovnou připravená k instalaci.
    await waitFor(() => {
      expect(within(dialog()).getByText(/Verze 0\.2\.0 je stažená a ověřená/)).toBeInTheDocument()
    })
    expect(within(dialog()).getByText('Rychlejší hledání')).toBeInTheDocument()
    // Stažené ano, nainstalované ne -- to je ten rozdíl, na kterém záleží.
    expect(updater.installs).toBe(0)

    // Teprve instalaci si uživatel odklikne, protože zavře aplikaci.
    await user.click(screen.getByRole('button', { name: 'Nainstalovat a restartovat' }))
    await waitFor(() => {
      expect(updater.installs).toBe(1)
      expect(updater.relaunched).toBe(true)
    })
  })

  it('mlčí, když je aplikace aktuální', async () => {
    await renderApp({ latest: null })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /verze 0\.1\.0/ })).toBeInTheDocument()
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('nenabídne starší ani stejnou verzi, ať server tvrdí cokoli', async () => {
    await renderApp({ latest: { version: '0.0.9' } })

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(updater.installs).toBe(0)
  })

  it('neotravuje oknem, když je síť pryč', async () => {
    await renderApp({ failCheck: 'Server neodpovídá.' })

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    // Bez internetu se nic neděje a aplikace funguje dál.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Text poznámky')).toBeInTheDocument()
  })

  it('se vůbec nespustí, když je automatická kontrola vypnutá', async () => {
    await renderApp({ latest: { version: '0.2.0' }, autoCheck: false })

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    // Ruční kontrola ale funguje dál -- vypíná se jen to, co se dělo samo.
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /verze 0\.1\.0/ }))
    await waitFor(() => {
      expect(within(dialog()).getByText(/Verze 0\.2\.0 je stažená a ověřená/)).toBeInTheDocument()
    })
  })
})

describe('ruční kontrola', () => {
  it('řekne, že je všechno aktuální', async () => {
    const user = userEvent.setup()
    await renderApp({ latest: null })

    await user.click(await screen.findByRole('button', { name: /verze 0\.1\.0/ }))
    expect(await screen.findByText('Máš nejnovější verzi (0.1.0).')).toBeInTheDocument()
  })

  it('jde spustit i z palety příkazů', async () => {
    const user = userEvent.setup()
    await renderApp({ latest: { version: '1.0.0', notes: 'Velká verze.' } , autoCheck: false })

    await user.keyboard('{Control>}k{/Control}')
    await user.type(await screen.findByLabelText('Příkaz nebo poznámka'), 'aktualiz')
    await user.click(await screen.findByRole('option', { name: /Zkontrolovat aktualizace/ }))

    await waitFor(() => {
      expect(within(dialog()).getByText(/Verze 1\.0\.0 je stažená a ověřená/)).toBeInTheDocument()
    })
  })

  it('ukáže chybu v okně, když ji vyvolal uživatel', async () => {
    const user = userEvent.setup()
    await renderApp({ failCheck: 'Server neodpovídá.', autoCheck: false })

    await user.click(await screen.findByRole('button', { name: /verze 0\.1\.0/ }))
    const failed = await screen.findByRole('dialog', { name: /nepovedla/i })
    expect(within(failed).getByText('Server neodpovídá.')).toBeInTheDocument()
  })

  it('nahlásí selhání stahování a nic nenainstaluje', async () => {
    await renderApp({
      latest: { version: '0.3.0', notes: 'Něco nového.' },
      failDownload: 'Spojení se přerušilo.',
    })

    const failed = await screen.findByRole('dialog', { name: /nepovedla/i })
    expect(within(failed).getByText('Spojení se přerušilo.')).toBeInTheDocument()
    expect(updater.installs).toBe(0)
  })
})

describe('okno aktualizace', () => {
  it('jde odložit a aplikace jede dál', async () => {
    const user = userEvent.setup()
    await renderApp({ latest: { version: '0.2.0', notes: 'Novinky.' } })

    await screen.findByText(/Verze 0\.2\.0 je stažená a ověřená/)
    await user.click(screen.getByRole('button', { name: 'Později' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(screen.getByLabelText('Text poznámky')).toBeInTheDocument()

    // Nabídka nezmizela, jen se schovala: stavový řádek na ni pořád upozorňuje.
    expect(screen.getByRole('button', { name: /připravená/i })).toBeInTheDocument()
  })

  it('uloží rozepsanou poznámku, než instalátor zavře okno', async () => {
    const user = userEvent.setup()
    await renderApp({ latest: { version: '0.2.0' } })

    await screen.findByText(/je stažená a ověřená/)
    await user.click(screen.getByRole('button', { name: 'Později' }))

    const editor = screen.getByLabelText('Text poznámky')
    await user.click(editor)
    await user.keyboard('{Control>}{End}{/Control}')
    await user.paste('\nNapsáno těsně před aktualizací.')

    await user.click(screen.getByRole('button', { name: /připravená/i }))
    await user.click(await screen.findByRole('button', { name: 'Nainstalovat a restartovat' }))

    await waitFor(() => {
      expect(vault.peek('poznamka-z-trezoru.md')).toContain('Napsáno těsně před aktualizací.')
    })
    expect(updater.installs).toBe(1)
  })
})

describe('prohlížeč bez desktopového běhového prostředí', () => {
  it('aktualizace vůbec nenabízí', async () => {
    await renderApp({ available: false, latest: { version: '9.9.9' } })

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(screen.queryByRole('button', { name: /verze /i })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
