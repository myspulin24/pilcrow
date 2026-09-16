/**
 * End-to-end: groups, right-click menus, the view switch and the side panel.
 *
 * These are the things the left rail is *for*: linking files that live in
 * different places into one list you can get back to. The persistence and the
 * access rules behind them are covered by the Rust tests in
 * `src-tauri/crates/reader-mj-core/src/collections.rs`.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { App } from '@/App'
import { StoreProvider } from '@/state/store'
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

const EXTERNAL_FILES = {
  '/docs/README.md': '# Docs\n\nTop level readme.\n',
  '/docs/guides/intro.md': '# Intro\n\nGetting started.\n',
}

let vault: MemoryVault

function renderApp() {
  vault = new MemoryVault({
    seed: { 'poznamka-z-trezoru.md': VAULT_NOTE, 'druha.md': '# Druhá\n\nDalší poznámka.\n' },
    label: 'Testovací trezor',
    externalFiles: EXTERNAL_FILES,
    externalRoot: '/docs',
  })
  return render(
    <StoreProvider vault={vault}>
      <App />
    </StoreProvider>,
  )
}

const rail = () => screen.getByLabelText('Skupiny a štítky')
const workspace = () => screen.getByLabelText('Pracovní plocha')
/**
 * A menu item anywhere in the open menu.
 *
 * Deliberately not scoped to one `role="menu"`: an open submenu is a second
 * one, and scoping would make every nested item ambiguous.
 */
const menuItem = (name: string | RegExp) => screen.findByRole('menuitem', { name })

/**
 * Right-click something.
 *
 * `fireEvent.contextMenu` rather than `user.pointer`: the pointer sequence for
 * a secondary button does not reliably produce a `contextmenu` event, and that
 * event is the whole point here.
 */
async function rightClick(_user: ReturnType<typeof userEvent.setup>, element: Element) {
  await act(async () => {
    fireEvent.contextMenu(element, { clientX: 40, clientY: 40 })
  })
}

async function openTheFolder(user: ReturnType<typeof userEvent.setup>) {
  await user.click(within(workspace()).getByRole('button', { name: 'Otevřít složku...' }))
  await waitFor(() => {
    expect(within(workspace()).getByRole('tree')).toBeInTheDocument()
  })
}

beforeEach(async () => {
  renderApp()
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
})

afterEach(() => {
  cleanup()
})

describe('groups', () => {
  it('starts empty and explains what a group is for', () => {
    expect(within(rail()).getByText('Skupiny')).toBeInTheDocument()
    expect(within(rail()).getByText(/odkudkoli z počítače/i)).toBeInTheDocument()
  })

  it('creates a group from the rail', async () => {
    const user = userEvent.setup()

    await user.click(within(rail()).getByRole('button', { name: 'Nová skupina' }))
    await user.type(await screen.findByLabelText('Název'), 'Bitdefender')
    await user.click(screen.getByRole('button', { name: 'Vytvořit' }))

    await waitFor(() => {
      expect(within(rail()).getByText('Bitdefender')).toBeInTheDocument()
    })
    // And it was persisted, not just put on screen.
    await waitFor(async () => {
      expect((await vault.loadCollections()).map((c) => c.name)).toEqual(['Bitdefender'])
    })
  })

  it('refuses a duplicate name and says why', async () => {
    const user = userEvent.setup()

    for (const attempt of ['Práce', 'práce']) {
      await user.click(within(rail()).getByRole('button', { name: 'Nová skupina' }))
      await user.type(await screen.findByLabelText('Název'), attempt)
      await user.click(screen.getByRole('button', { name: 'Vytvořit' }))
    }

    expect(await screen.findByText(/už máš/i)).toBeInTheDocument()
    expect((await vault.loadCollections())).toHaveLength(1)
  })

  it('links a vault note and an external file into the same group', async () => {
    const user = userEvent.setup()

    // A group to put things in.
    await user.click(within(rail()).getByRole('button', { name: 'Nová skupina' }))
    await user.type(await screen.findByLabelText('Název'), 'Smíchané')
    await user.click(screen.getByRole('button', { name: 'Vytvořit' }))
    await waitFor(() => expect(within(rail()).getByText('Smíchané')).toBeInTheDocument())

    // A note from the vault, via right-click.
    await rightClick(user, within(screen.getByLabelText('Poznámky')).getByText('Poznámka z trezoru'))
    await user.click(await menuItem(/Přidat do skupiny/))
    await user.click(await menuItem('Smíchané'))

    // And a file from a folder somewhere else entirely.
    await openTheFolder(user)
    await rightClick(user, within(workspace()).getByRole('button', { name: /README\.md/ }))
    await user.click(await menuItem(/Přidat do skupiny/))
    await user.click(await menuItem('Smíchané'))

    await waitFor(async () => {
      const [group] = await vault.loadCollections()
      expect(group?.items.map((item) => item.path).sort()).toEqual([
        '/docs/README.md',
        'poznamka-z-trezoru.md',
      ])
    })

    // Both show up under the group once it is expanded.
    await user.click(within(rail()).getByRole('button', { name: 'Smíchané' }))
    await waitFor(() => {
      // A note shows its title; an external file shows its file name.
      expect(within(rail()).getByText('Poznámka z trezoru')).toBeInTheDocument()
      expect(within(rail()).getByText('README')).toBeInTheDocument()
    })
  })

  it('opens a linked external file straight from the group', async () => {
    const user = userEvent.setup()
    await openTheFolder(user)
    // The tree opens collapsed, so reveal the file first.
    await user.click(within(workspace()).getByRole('button', { name: /guides/ }))

    await rightClick(user, await within(workspace()).findByRole('button', { name: /intro\.md/ }))
    await user.click(await menuItem(/Přidat do skupiny/))
    await user.click(await menuItem(/Vytvořit první skupinu/))
    await user.type(await screen.findByLabelText('Název'), 'Později')
    await user.click(screen.getByRole('button', { name: 'Vytvořit a přidat' }))

    await waitFor(() => expect(within(rail()).getByText('Později')).toBeInTheDocument())
    await user.click(within(rail()).getByRole('button', { name: 'Později' }))

    // Close the folder, so the only route to the file is the group itself.
    await user.click(within(workspace()).getByRole('button', { name: 'Zavřít složku' }))
    await user.click(await within(rail()).findByRole('button', { name: /intro/ }))

    await waitFor(() => {
      expect(screen.getByLabelText('Text poznámky')).toHaveValue(EXTERNAL_FILES['/docs/guides/intro.md'])
    })
  })

  it('removes a file from a group without deleting the file', async () => {
    const user = userEvent.setup()

    await user.click(within(rail()).getByRole('button', { name: 'Nová skupina' }))
    await user.type(await screen.findByLabelText('Název'), 'Dočasná')
    await user.click(screen.getByRole('button', { name: 'Vytvořit' }))
    await waitFor(() => expect(within(rail()).getByText('Dočasná')).toBeInTheDocument())

    await rightClick(user, within(screen.getByLabelText('Poznámky')).getByText('Poznámka z trezoru'))
    await user.click(await menuItem(/Přidat do skupiny/))
    await user.click(await menuItem('Dočasná'))

    await user.click(within(rail()).getByRole('button', { name: 'Dočasná' }))
    const linked = await within(rail()).findByRole('button', { name: /Poznámka z trezoru/ })

    await rightClick(user, linked)
    await user.click(await menuItem(/Odebrat ze skupiny/))

    await waitFor(async () => {
      expect((await vault.loadCollections())[0]?.items).toHaveLength(0)
    })
    // The note itself is untouched.
    expect(vault.peek('poznamka-z-trezoru.md')).toContain('Je v trezoru.')
  })

  it('deletes a group but keeps its files', async () => {
    const user = userEvent.setup()

    await user.click(within(rail()).getByRole('button', { name: 'Nová skupina' }))
    await user.type(await screen.findByLabelText('Název'), 'Nanečisto')
    await user.click(screen.getByRole('button', { name: 'Vytvořit' }))
    await waitFor(() => expect(within(rail()).getByText('Nanečisto')).toBeInTheDocument())

    await user.click(within(rail()).getByRole('button', { name: /Akce pro skupinu Nanečisto/ }))
    await user.click(await menuItem(/Smazat skupinu/))
    await user.click(await screen.findByRole('button', { name: 'Smazat skupinu' }))

    await waitFor(() => {
      expect(within(rail()).queryByText('Nanečisto')).not.toBeInTheDocument()
    })
    expect(vault.peek('poznamka-z-trezoru.md')).toBeDefined()
  })
})

describe('deleting from the right-click menu', () => {
  it('deletes a vault note after confirming', async () => {
    const user = userEvent.setup()

    await rightClick(user, within(screen.getByLabelText('Poznámky')).getByText('Poznámka z trezoru'))
    await user.click(await menuItem(/Smazat poznámku/))

    const dialog = await screen.findByRole('alertdialog', { name: /Smazat poznámku/ })
    expect(within(dialog).getByText(/zmizí z trezoru/i)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Smazat' }))

    await waitFor(() => {
      expect(vault.paths()).not.toContain('poznamka-z-trezoru.md')
    })
  })

  it('deletes an external file from disk, and drops it from its group', async () => {
    const user = userEvent.setup()
    await openTheFolder(user)

    // Link it first, so we can prove the link is cleaned up too.
    await rightClick(user, within(workspace()).getByRole('button', { name: /README\.md/ }))
    await user.click(await menuItem(/Přidat do skupiny/))
    await user.click(await menuItem(/Vytvořit první skupinu/))
    await user.type(await screen.findByLabelText('Název'), 'Dokumentace')
    await user.click(screen.getByRole('button', { name: 'Vytvořit a přidat' }))
    await waitFor(async () => {
      expect((await vault.loadCollections())[0]?.items).toHaveLength(1)
    })

    await rightClick(user, within(workspace()).getByRole('button', { name: /README\.md/ }))
    await user.click(await menuItem(/Smazat soubor/))

    const dialog = await screen.findByRole('alertdialog', { name: /Smazat soubor/ })
    expect(within(dialog).getByText(/zmizí z disku/i)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Smazat' }))

    await waitFor(() => {
      expect(vault.peekExternal('/docs/README.md')).toBeUndefined()
    })
    await waitFor(async () => {
      expect((await vault.loadCollections())[0]?.items).toHaveLength(0)
    })
  })

  it('closes the menu on Escape without doing anything', async () => {
    const user = userEvent.setup()

    await rightClick(user, within(screen.getByLabelText('Poznámky')).getByText('Poznámka z trezoru'))
    expect(await screen.findByRole('menu')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
    expect(vault.paths()).toContain('poznamka-z-trezoru.md')
  })
})

describe('the view switch', () => {
  const switcher = () => screen.getByRole('radiogroup', { name: 'Zobrazení dokumentu' })

  it('starts split and moves through all three positions', async () => {
    const user = userEvent.setup()
    await screen.findByLabelText('Text poznámky')

    expect(within(switcher()).getByRole('radio', { name: 'Obojí' })).toBeChecked()
    expect(screen.getByLabelText('Text poznámky')).toBeInTheDocument()
    expect(screen.getByLabelText('Náhled')).toBeInTheDocument()

    await user.click(within(switcher()).getByRole('radio', { name: 'Náhled' }))
    await waitFor(() => {
      expect(screen.queryByLabelText('Text poznámky')).not.toBeInTheDocument()
    })
    expect(screen.getByLabelText('Náhled')).toBeInTheDocument()

    await user.click(within(switcher()).getByRole('radio', { name: 'Zdroj' }))
    await waitFor(() => {
      expect(screen.queryByLabelText('Náhled')).not.toBeInTheDocument()
    })
    expect(screen.getByLabelText('Text poznámky')).toBeInTheDocument()
  })

  it('cycles with Ctrl+E', async () => {
    const user = userEvent.setup()
    await screen.findByLabelText('Text poznámky')

    await user.keyboard('{Control>}e{/Control}')
    await waitFor(() => {
      expect(within(switcher()).getByRole('radio', { name: 'Náhled' })).toBeChecked()
    })

    // Wraps around to the start.
    await user.keyboard('{Control>}e{/Control}')
    await waitFor(() => {
      expect(within(switcher()).getByRole('radio', { name: 'Zdroj' })).toBeChecked()
    })
  })

  it('moves with the arrow keys and stops at the ends', async () => {
    const user = userEvent.setup()
    await screen.findByLabelText('Text poznámky')

    within(switcher()).getByRole('radio', { name: 'Obojí' }).focus()
    await user.keyboard('{ArrowLeft}')
    await waitFor(() => {
      expect(within(switcher()).getByRole('radio', { name: 'Zdroj' })).toBeChecked()
    })

    await user.keyboard('{ArrowLeft}')
    expect(within(switcher()).getByRole('radio', { name: 'Zdroj' })).toBeChecked()
  })
})

describe('the side panel', () => {
  it('hides and comes back', async () => {
    const user = userEvent.setup()

    await user.click(within(rail()).getByRole('button', { name: 'Skrýt boční panel' }))
    await waitFor(() => {
      expect(screen.queryByLabelText('Skupiny a štítky')).not.toBeInTheDocument()
    })

    await user.click(await screen.findByRole('button', { name: 'Zobrazit boční panel' }))
    await waitFor(() => {
      expect(screen.getByLabelText('Skupiny a štítky')).toBeInTheDocument()
    })
  })

  it('also toggles from the keyboard', async () => {
    const user = userEvent.setup()

    await user.keyboard('{Control>}\\{/Control}')
    await waitFor(() => {
      expect(screen.queryByLabelText('Skupiny a štítky')).not.toBeInTheDocument()
    })

    await user.keyboard('{Control>}\\{/Control}')
    await waitFor(() => {
      expect(screen.getByLabelText('Skupiny a štítky')).toBeInTheDocument()
    })
  })
})
