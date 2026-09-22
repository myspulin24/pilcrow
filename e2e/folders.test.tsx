/**
 * End-to-end: víc otevřených složek naráz.
 *
 * Do 0.9 byla otevřená vždycky nejvýš jedna a všechno kolem gitu se vázalo
 * na ni. Teď jich může být víc a jedna z nich je *aktivní* -- ta, ke které
 * patří sekce Git. Testuje se hlavně to, co z toho plyne:
 *
 *  - stromy se nepletou dohromady (rozbalení, obnovení, zavření),
 *  - aktivní složka se pozná a přepíná,
 *  - git se ptá na aktivní složku, ne na tu, která se otevřela první,
 *  - po restartu se otevřou všechny, aktivní zůstane aktivní.
 */

import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { App } from '@/App'
import { MemoryGit } from '@/git'
import { StoreProvider } from '@/state/store'
import { MemoryVault, type VaultSettings } from '@/vault'

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
].join('\n')

/** Dvě nezávislé složky, každá v jiném „repozitáři“. */
const EXTERNAL_FILES = {
  '/prvni/README.md': '# První\n',
  '/prvni/docs/uvod.md': '# Úvod\n',
  '/druhy/README.md': '# Druhý\n',
  '/druhy/docs/navod.md': '# Návod\n',
}

let vault: MemoryVault
let git: MemoryGit

type User = ReturnType<typeof userEvent.setup>

async function renderApp(settings: Partial<VaultSettings> = {}) {
  vault = new MemoryVault({
    seed: { 'poznamka.md': VAULT_NOTE },
    label: 'Testovací trezor',
    externalFiles: EXTERNAL_FILES,
    externalRoots: ['/prvni', '/druhy'],
    settings,
  })
  git = new MemoryGit()
  render(
    <StoreProvider vault={vault} git={git}>
      <App />
    </StoreProvider>,
  )
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const workspace = () => screen.getByLabelText('Pracovní plocha')
const folderToggle = (name: string) => within(workspace()).getByRole('button', { name: new RegExp(`^${name}`) })
/** Hlavičky bloků se složkami, v pořadí, jak jsou ve sloupci. */
const openFolderNames = () =>
  [...workspace().querySelectorAll('[id^="ws-files-"] .ws-section__label')].map(
    (node) => node.textContent ?? '',
  )

async function openFolder(user: User) {
  await user.click(within(workspace()).getByRole('button', { name: 'Otevřít složku...' }))
}

async function openBoth(user: User) {
  await openFolder(user)
  await waitFor(() => expect(openFolderNames()).toEqual(['prvni']))
  await openFolder(user)
  await waitFor(() => expect(openFolderNames()).toEqual(['prvni', 'druhy']))
}

afterEach(() => {
  cleanup()
})

describe('víc složek ve sloupci', () => {
  it('otevře druhou složku, aniž by první zavřela', async () => {
    const user = userEvent.setup()
    await renderApp()
    await openBoth(user)

    // Každá má svůj strom.
    expect(within(workspace()).getAllByRole('tree')).toHaveLength(2)
  })

  it('tatáž složka podruhé nepřibude jako druhý blok', async () => {
    const user = userEvent.setup()
    await renderApp()
    await openBoth(user)

    // Fronta výběru došla, takže další výběr vrátí zase `/druhy`.
    await openFolder(user)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(openFolderNames()).toEqual(['prvni', 'druhy'])
  })

  it('rozbalení podsložky v jednom stromu se nepromítne do druhého', async () => {
    const user = userEvent.setup()
    await renderApp()
    await openBoth(user)

    // Podsložka `docs` je v obou stromech; tady se rozbaluje ta v první.
    await user.click(within(workspace()).getAllByRole('button', { name: /docs/ })[0]!)
    await waitFor(() => {
      expect(within(workspace()).getByRole('button', { name: /uvod\.md/ })).toBeInTheDocument()
    })
    // Druhá složka zůstala sbalená -- kdyby se rozbalené podsložky sdílely,
    // objevil by se i `navod.md`.
    expect(within(workspace()).queryByRole('button', { name: /navod\.md/ })).not.toBeInTheDocument()
  })

  it('zavření jedné složky nechá druhou otevřenou', async () => {
    const user = userEvent.setup()
    await renderApp()
    await openBoth(user)

    const buttons = within(workspace()).getAllByRole('button', { name: 'Zavřít složku' })
    await user.click(buttons[0]!)

    await waitFor(() => expect(openFolderNames()).toEqual(['druhy']))
  })
})

describe('aktivní složka', () => {
  it('nově otevřená složka se stane aktivní', async () => {
    const user = userEvent.setup()
    await renderApp()
    await openBoth(user)

    expect(folderToggle('prvni')).toHaveAttribute('aria-current', 'false')
    expect(folderToggle('druhy')).toHaveAttribute('aria-current', 'true')
  })

  it('kliknutí do hlavičky přepne aktivní složku, ale blok nesbalí', async () => {
    const user = userEvent.setup()
    await renderApp()
    await openBoth(user)

    await user.click(folderToggle('prvni'))

    await waitFor(() => expect(folderToggle('prvni')).toHaveAttribute('aria-current', 'true'))
    expect(folderToggle('druhy')).toHaveAttribute('aria-current', 'false')
    // Blok zůstal rozbalený: první kliknutí vybírá, teprve druhé sbaluje.
    expect(folderToggle('prvni')).toHaveAttribute('aria-expanded', 'true')

    await user.click(folderToggle('prvni'))
    await waitFor(() => expect(folderToggle('prvni')).toHaveAttribute('aria-expanded', 'false'))
  })

  it('otevření souboru přepne aktivní složku na tu jeho', async () => {
    const user = userEvent.setup()
    await renderApp()
    await openBoth(user)
    await user.click(folderToggle('prvni'))
    await waitFor(() => expect(folderToggle('prvni')).toHaveAttribute('aria-current', 'true'))

    // Soubor z druhé složky: aktivní se má stát ona, ne ta, ve které stojíme.
    await user.click(within(workspace()).getAllByRole('button', { name: /README\.md/ })[1]!)

    await waitFor(() => expect(folderToggle('druhy')).toHaveAttribute('aria-current', 'true'))
  })

  it('git se ptá na aktivní složku, ne na tu otevřenou první', async () => {
    const user = userEvent.setup()
    await renderApp()
    await openBoth(user)

    await waitFor(() => expect(git.probedFolders.at(-1)).toBe('/druhy'))

    await user.click(folderToggle('prvni'))
    await waitFor(() => expect(git.probedFolders.at(-1)).toBe('/prvni'))
  })

  it('sekce Git je hned pod aktivní složkou', async () => {
    const user = userEvent.setup()
    await renderApp()
    await openBoth(user)

    const gitSection = () => within(workspace()).getByRole('button', { name: /^Git\b/ }).closest('section')!
    const folderSection = (name: string) => folderToggle(name).closest('section')!

    await waitFor(() => expect(gitSection()).toBeInTheDocument())
    expect(folderSection('druhy').nextElementSibling).toBe(gitSection())

    await user.click(folderToggle('prvni'))
    await waitFor(() => expect(folderSection('prvni').nextElementSibling).toBe(gitSection()))
  })

  it('po zavření aktivní složky přebírá ta zbylá', async () => {
    const user = userEvent.setup()
    await renderApp()
    await openBoth(user)

    const closeButtons = within(workspace()).getAllByRole('button', { name: 'Zavřít složku' })
    await user.click(closeButtons[1]!)

    await waitFor(() => expect(folderToggle('prvni')).toHaveAttribute('aria-current', 'true'))
  })
})

describe('po restartu', () => {
  it('otevřou se všechny zapamatované složky a aktivní zůstane aktivní', async () => {
    await renderApp({ openFolders: ['/druhy', '/prvni'] })

    await waitFor(() => expect(openFolderNames()).toEqual(['prvni', 'druhy']))
    // Uložená první je aktivní, i když ve sloupci není první.
    expect(folderToggle('druhy')).toHaveAttribute('aria-current', 'true')
  })

  it('cesta, která zmizela, se jen vynechá a z nastavení se ztratí', async () => {
    await renderApp({ openFolders: ['/prvni', '/uz-neni'] })

    await waitFor(() => expect(openFolderNames()).toEqual(['prvni']))
    await waitFor(async () => {
      expect((await vault.loadSettings()).openFolders).toEqual(['/prvni'])
    })
  })

  it('nastavení od starší verze se dvěma poli se přečte taky', async () => {
    // `openFolders` neznala; uměla jen `lastFolder`.
    await renderApp({ lastFolder: '/druhy' })

    await waitFor(() => expect(openFolderNames()).toEqual(['druhy']))
  })

  it('otevřené složky se ukládají, aktivní první', async () => {
    const user = userEvent.setup()
    await renderApp()
    await openBoth(user)

    await waitFor(async () => {
      const settings = await vault.loadSettings()
      expect(settings.openFolders).toEqual(['/druhy', '/prvni'])
      // Starší verze aplikace čte tohle pole; má v něm být aktivní složka.
      expect(settings.lastFolder).toBe('/druhy')
    })
  })
})
