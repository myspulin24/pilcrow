/**
 * End-to-end: the file tree in the workspace column.
 *
 * Drives the real `<App />` through the DOM against the in-memory adapter,
 * which stands in for the file system the same way it does for the vault. The
 * folder scan itself -- pruning, ordering, depth limits, and the access rules
 * that decide what may be read at all -- is covered by the Rust tests in
 * `src-tauri/crates/pilcrow-core/src/explorer.rs`.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { App } from '@/App'
import { StoreProvider } from '@/state/store'
import type { VaultSettings } from '@/vault'
import { MemoryVault, toIndexRecord } from '@/vault'

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

/** A folder of someone else's Markdown, outside the vault. */
const EXTERNAL_FILES = {
  '/docs/README.md': '# Docs\n\nTop level readme.\n',
  '/docs/guides/intro.md': '# Intro\n\nGetting started.\n\n- [ ] read this\n',
  '/docs/guides/deep/advanced.md': '# Advanced\n\nDeep content.\n',
  '/docs/reference/api.md': '# API\n\nReference.\n',
  '/elsewhere/standalone.md': '# Standalone\n\nOpened on its own.\n',
}

let vault: MemoryVault

function renderApp(settings?: Partial<VaultSettings>) {
  vault = new MemoryVault({
    seed: { 'poznamka-z-trezoru.md': VAULT_NOTE },
    label: 'Testovací trezor',
    externalFiles: EXTERNAL_FILES,
    externalRoot: '/docs',
    dialogFile: '/elsewhere/standalone.md',
    settings,
  })
  return render(
    <StoreProvider vault={vault}>
      <App />
    </StoreProvider>,
  )
}

const workspace = () => screen.getByLabelText('Pracovní plocha')
const editor = () => screen.getByLabelText('Text poznámky') as HTMLTextAreaElement
const noteHeader = () => screen.getByLabelText('Hlavička poznámky')

/** The rows currently visible in the tree, by name. */
function treeRowNames(): string[] {
  const tree = within(workspace()).queryByRole('tree')
  if (!tree) return []
  return within(tree)
    .getAllByRole('treeitem')
    .map((row) => row.textContent?.replace(/[▸▾\u{1F4C1}\u{1F4C2}\u{1F4C4}]/gu, '').trim() ?? '')
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

describe('opening a folder', () => {
  it('shows folders and .md files, with nested levels collapsed', async () => {
    const user = userEvent.setup()

    // Before anything is opened there is no Files section at all.
    expect(within(workspace()).queryByRole('tree')).not.toBeInTheDocument()

    await openTheFolder(user)

    // Folders first, then files -- and nothing from inside them yet.
    expect(treeRowNames()).toEqual(['guides', 'reference', 'README.md'])
    expect(treeRowNames()).not.toContain('intro.md')

    // The section header reports what was scanned.
    expect(within(workspace()).getByText('docs')).toBeInTheDocument()
    expect(within(workspace()).getByText(/4 soubory/)).toBeInTheDocument()
  })

  it('expands and collapses a folder', async () => {
    const user = userEvent.setup()
    await openTheFolder(user)

    await user.click(within(workspace()).getByRole('button', { name: /guides/ }))
    await waitFor(() => {
      // `deep` is a folder, so it sorts above `intro.md`.
      expect(treeRowNames()).toEqual(['guides', 'deep', 'intro.md', 'reference', 'README.md'])
    })

    // The row reports its own state for assistive tech.
    const guides = within(workspace())
      .getAllByRole('treeitem')
      .find((row) => row.textContent?.includes('guides'))
    expect(guides).toHaveAttribute('aria-expanded', 'true')

    await user.click(within(workspace()).getByRole('button', { name: /guides/ }))
    await waitFor(() => {
      expect(treeRowNames()).toEqual(['guides', 'reference', 'README.md'])
    })
  })

  it('nests deeper folders as they are opened', async () => {
    const user = userEvent.setup()
    await openTheFolder(user)

    await user.click(within(workspace()).getByRole('button', { name: /guides/ }))
    await user.click(await screen.findByRole('button', { name: /deep/ }))

    await waitFor(() => {
      expect(treeRowNames()).toContain('advanced.md')
    })
  })

  it('expands and collapses every folder at once', async () => {
    const user = userEvent.setup()
    await openTheFolder(user)

    await user.click(within(workspace()).getByRole('button', { name: 'Rozbalit všechny složky' }))
    await waitFor(() => {
      expect(treeRowNames()).toEqual([
        'guides',
        'deep',
        'advanced.md',
        'intro.md',
        'reference',
        'api.md',
        'README.md',
      ])
    })

    await user.click(within(workspace()).getByRole('button', { name: 'Sbalit všechny složky' }))
    await waitFor(() => {
      expect(treeRowNames()).toEqual(['guides', 'reference', 'README.md'])
    })
  })

  it('filters the tree by name, keeping the path to each hit', async () => {
    const user = userEvent.setup()
    await openTheFolder(user)

    await user.type(screen.getByLabelText('Hledat v poznámkách a souborech'), 'advanced')
    await waitFor(() => {
      // The folders leading to the hit stay, and are auto-expanded.
      expect(treeRowNames()).toEqual(['guides', 'deep', 'advanced.md'])
    })

    await user.clear(screen.getByLabelText('Hledat v poznámkách a souborech'))
    await waitFor(() => {
      expect(treeRowNames()).toEqual(['guides', 'reference', 'README.md'])
    })
  })

  it('says so when a filter matches nothing', async () => {
    const user = userEvent.setup()
    await openTheFolder(user)

    await user.type(screen.getByLabelText('Hledat v poznámkách a souborech'), 'zzzz')
    expect(
      await within(workspace()).findByText('Žádný soubor neodpovídá hledání.'),
    ).toBeInTheDocument()
  })

  it('closes the folder again', async () => {
    const user = userEvent.setup()
    await openTheFolder(user)

    await user.click(within(workspace()).getByRole('button', { name: 'Zavřít složku' }))
    await waitFor(() => {
      expect(within(workspace()).queryByRole('tree')).not.toBeInTheDocument()
    })
  })
})

describe('reading a file from the tree', () => {
  it('opens it, renders it, and marks it as external', async () => {
    const user = userEvent.setup()
    await openTheFolder(user)

    await user.click(within(workspace()).getByRole('button', { name: /guides/ }))
    await user.click(await screen.findByRole('button', { name: /intro\.md/ }))

    await waitFor(() => {
      expect(within(noteHeader()).getByRole('heading')).toHaveTextContent('intro.md')
    })
    // Its provenance is visible: this file is not part of the vault.
    expect(within(noteHeader()).getByText('externí soubor')).toBeInTheDocument()
    expect(editor().value).toBe(EXTERNAL_FILES['/docs/guides/intro.md'])

    // And it renders, tasks and all.
    const preview = screen.getByLabelText('Náhled')
    await waitFor(() => {
      expect(preview.querySelector('h1')?.textContent).toBe('Intro')
    })
    expect(preview.querySelectorAll('input[type="checkbox"]')).toHaveLength(1)
  })

  it('has no backlinks panel, because it is not part of the vault', async () => {
    const user = userEvent.setup()
    await openTheFolder(user)
    await user.click(within(workspace()).getByRole('button', { name: /README\.md/ }))

    await waitFor(() => {
      expect(within(noteHeader()).getByRole('heading')).toHaveTextContent('README.md')
    })
    expect(screen.queryByLabelText('Zpětné odkazy')).not.toBeInTheDocument()
  })

  it('saves it back verbatim, without adding frontmatter', async () => {
    const user = userEvent.setup()
    await openTheFolder(user)
    await user.click(within(workspace()).getByRole('button', { name: /README\.md/ }))
    await waitFor(() => {
      expect(editor().value).toContain('Top level readme.')
    })

    await user.click(editor())
    await user.keyboard('{Control>}{End}{/Control}')
    await user.paste('\nMoje úprava.\n')

    await waitFor(
      () => {
        expect(vault.peekExternal('/docs/README.md')).toContain('Moje úprava.')
      },
      { timeout: 5000 },
    )

    // The crucial part: someone else's file is not rewritten with our metadata.
    const saved = vault.peekExternal('/docs/README.md')!
    expect(saved.startsWith('# Docs')).toBe(true)
    expect(saved).not.toContain('---')
    expect(saved).not.toContain('id:')
  })

  it('refuses to overwrite an external file that changed underneath', async () => {
    const user = userEvent.setup()
    await openTheFolder(user)
    await user.click(within(workspace()).getByRole('button', { name: /README\.md/ }))
    await waitFor(() => {
      expect(editor().value).toContain('Top level readme.')
    })

    await user.click(editor())
    await user.keyboard('{Control>}{End}{/Control}')
    await user.paste('\nMoje neuložená úprava.\n')

    vault.simulateExternalFileEdit('/docs/README.md', '# Docs\n\nChanged by another program.\n')

    const dialog = await screen.findByRole('dialog', { name: /změnil na disku/i })
    expect(within(dialog).getByText(/Changed by another program\./)).toBeInTheDocument()
    expect(within(dialog).getByText(/Moje neuložená úprava\./)).toBeInTheDocument()
  })
})

describe('opening a single file', () => {
  it('opens just that file, with no tree around it', async () => {
    const user = userEvent.setup()

    await user.click(within(workspace()).getByRole('button', { name: 'Otevřít soubor...' }))

    await waitFor(() => {
      expect(within(noteHeader()).getByRole('heading')).toHaveTextContent('standalone.md')
    })
    expect(editor().value).toBe(EXTERNAL_FILES['/elsewhere/standalone.md'])

    // No tree: a single file is not a folder, and the panel says what to do
    // next. (The hint spans a <strong>, so match the tail of the sentence --
    // getByText compares direct text nodes, not nested markup.)
    expect(within(workspace()).queryByRole('tree')).not.toBeInTheDocument()
    expect(
      within(workspace()).getByText(/celý strom souborů/i),
    ).toBeInTheDocument()
  })
})

describe('the explorer and the vault coexist', () => {
  it('switches between a vault note and an external file', async () => {
    const user = userEvent.setup()

    // Starts on the vault note.
    await waitFor(() => {
      expect(within(noteHeader()).getByRole('heading')).toHaveTextContent('Poznámka z trezoru')
    })
    expect(within(noteHeader()).queryByText('externí soubor')).not.toBeInTheDocument()

    await openTheFolder(user)
    await user.click(within(workspace()).getByRole('button', { name: /README\.md/ }))
    await waitFor(() => {
      expect(within(noteHeader()).getByText('externí soubor')).toBeInTheDocument()
    })

    // Back to the vault, and the vault-only chrome returns. The note list
    // unmounts while a refresh is in flight, so find the row rather than
    // holding a reference to it.
    await user.click(await screen.findByRole('button', { name: /Poznámka z trezoru/ }))
    await waitFor(
      () => {
        expect(within(noteHeader()).queryByText('externí soubor')).not.toBeInTheDocument()
      },
      { timeout: 5000 },
    )
    expect(screen.getByLabelText('Zpětné odkazy')).toBeInTheDocument()
  })

  it('collapses and expands the Files section with Ctrl+B', async () => {
    const user = userEvent.setup()
    await openTheFolder(user)

    await user.keyboard('{Control>}b{/Control}')
    await waitFor(() => {
      expect(within(workspace()).queryByRole('tree')).not.toBeInTheDocument()
    })
    // The folder is still open -- only the section is folded.
    expect(within(workspace()).getByText('docs')).toBeInTheDocument()

    await user.keyboard('{Control>}b{/Control}')
    await waitFor(() => {
      expect(within(workspace()).getByRole('tree')).toBeInTheDocument()
    })
  })

  /**
   * Soubor z repozitáře mezi poznámkami.
   *
   * Dřív se přesouval do trezoru. To v repozitáři nechávalo díru a
   * dokumentace se rozdělila na dvě místa, takže se to obrátilo: soubor
   * zůstane, kde je, a v trezoru vznikne poznámka, která na něj ukazuje.
   * Otevřít ji znamená otevřít ten soubor; štítky zůstávají v poznámce.
   */
  describe('soubor mezi poznámkami', () => {
    const menuItem = (name: string | RegExp) => screen.findByRole('menuitem', { name })

    /**
     * Pravé tlačítko na soubor ve stromu.
     *
     * Cílem je `button` uvnitř řádku, ne `li[role=treeitem]`: obsluha visí
     * na tlačítku a události bublají nahoru, ne dolů.
     */
    async function rightClickFile(name: RegExp) {
      const button = within(workspace()).getByRole('button', { name })
      await act(async () => {
        fireEvent.contextMenu(button, { clientX: 40, clientY: 40 })
      })
    }

    async function linkReadme(user: ReturnType<typeof userEvent.setup>) {
      await rightClickFile(/README.md/)
      await user.click(await menuItem(/Dát mezi poznámky/))
      const dialog = await screen.findByRole('alertdialog', { name: /Dát mezi poznámky/ })
      await user.click(within(dialog).getByRole('button', { name: 'Dát mezi poznámky' }))
    }

    it('soubor zůstane v repu, v poznámkách vznikne odkaz na něj', async () => {
      const user = userEvent.setup()
      await openTheFolder(user)
      await linkReadme(user)

      await waitFor(async () => {
        expect((await vault.readNote('README.md')).content).toContain('source: "/docs/README.md"')
      })
      // Soubor je pořád tam, kde byl -- tohle není přesun ani kopie.
      expect(vault.peekExternal('/docs/README.md')).toContain('Top level readme.')
      // A ve stromu zůstal.
      expect(treeRowNames()).toContain('README.md')
      // Text poznámky je popisek, ne obsah souboru: kopie by zastarala.
      expect((await vault.readNote('README.md')).content).not.toContain('Top level readme.')
    })

    it('otevřít ji znamená otevřít ten soubor', async () => {
      const user = userEvent.setup()
      await openTheFolder(user)
      await linkReadme(user)

      // V editoru je soubor z repozitáře, ne text poznámky.
      await waitFor(() => {
        expect(editor().value).toContain('Top level readme.')
      })
      expect(within(noteHeader()).getByText('odkaz z poznámek')).toBeInTheDocument()

      // A uloží se do něj, ne do trezoru.
      await user.click(editor())
      await user.keyboard('{Control>}a{/Control}')
      await user.keyboard('# Docs\n\nPřepsáno.')
      await user.keyboard('{Control>}s{/Control}')

      await waitFor(() => {
        expect(vault.peekExternal('/docs/README.md')).toContain('Přepsáno.')
      })
      expect((await vault.readNote('README.md')).content).not.toContain('Přepsáno.')
    })

    it('štítky jdou do poznámky, do souboru se nezapíšou', async () => {
      const user = userEvent.setup()
      await openTheFolder(user)
      await linkReadme(user)
      await waitFor(() => expect(editor().value).toContain('Top level readme.'))

      const field = within(noteHeader()).getByLabelText('Štítky')
      await user.click(field)
      await user.keyboard('#dokumentace repo/docs{Enter}')

      await waitFor(async () => {
        expect((await vault.readNote('README.md')).content).toContain('tags: [dokumentace, repo/docs]')
      })
      // Do cizího souboru Pilcrow nic nepřipisuje.
      expect(vault.peekExternal('/docs/README.md')).not.toContain('dokumentace')
      // A cesta k souboru se tím neztratila.
      expect((await vault.readNote('README.md')).content).toContain('source: "/docs/README.md"')
    })

    it('poznámka se stejným jménem se nepřepíše, odkaz se očísluje', async () => {
      const user = userEvent.setup()
      const mine = ['# Moje', '', 'Tohle tu bylo první.', ''].join('\n')
      await act(async () => {
        await vault.createNote({ path: 'README.md', content: mine, record: toIndexRecord('README.md', mine) })
      })
      await openTheFolder(user)
      await linkReadme(user)

      await waitFor(async () => {
        expect((await vault.readNote('README 2.md')).content).toContain('source: "/docs/README.md"')
      })
      expect((await vault.readNote('README.md')).content).toContain('Tohle tu bylo první.')
    })

    it('smazat otevřený odkaz smaže poznámku, ne soubor', async () => {
      const user = userEvent.setup()
      await openTheFolder(user)
      await linkReadme(user)
      await waitFor(() => expect(editor().value).toContain('Top level readme.'))

      await user.keyboard('{Control>}k{/Control}')
      await user.type(await screen.findByLabelText('Příkaz nebo poznámka'), 'smazat pozn')
      await user.click(await screen.findByRole('option', { name: /Smazat poznámku/ }))
      const dialog = await screen.findByRole('alertdialog')
      await user.click(within(dialog).getByRole('button', { name: 'Smazat' }))

      // Poznámka je pryč...
      await waitFor(async () => {
        await expect(vault.readNote('README.md')).rejects.toBeTruthy()
      })
      // ...soubor v repozitáři zůstal.
      expect(vault.peekExternal('/docs/README.md')).toContain('Top level readme.')
    })

    it('odkaz na soubor, který zmizel, to řekne a nic neotevře', async () => {
      const user = userEvent.setup()
      await openTheFolder(user)
      await linkReadme(user)
      await waitFor(() => expect(editor().value).toContain('Top level readme.'))

      // Soubor zmizí z disku (třeba smazaný v repu) a poznámka se otevře znovu.
      await act(async () => {
        await vault.deleteExternalFile('/docs/README.md')
      })
      // Seznam poznámek je v levém panelu, strom souborů ve vedlejším.
      const notes = screen.getByRole('list', { name: 'Poznámky' })
      await user.click(within(notes).getByRole('button', { name: /README\.md/ }))

      expect(await screen.findByText(/na disku není/)).toBeInTheDocument()
    })
  })

  describe('pamatuje si, co bylo otevřené', () => {
    /** Zavři aplikaci a spusť ji znovu s nastavením, které po sobě nechala. */
    async function restart() {
      const settings = await vault.loadSettings()
      cleanup()
      renderApp(settings)
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      return settings
    }

    it('otevře po startu složku z minulého spuštění', async () => {
      const user = userEvent.setup()
      await openTheFolder(user)

      const settings = await restart()
      expect(settings.lastFolder).toBe('/docs')

      // Nikdo nic neklikl -- strom je tam sám od sebe.
      await waitFor(() => {
        expect(within(workspace()).getByRole('tree')).toBeInTheDocument()
      })
      expect(treeRowNames()).toContain('README.md')
    })

    it('otevře po startu samostatný soubor z minulého spuštění', async () => {
      const user = userEvent.setup()
      await user.click(within(workspace()).getByRole('button', { name: 'Otevřít soubor...' }))
      await waitFor(() => {
        expect(within(workspace()).getByText('standalone.md')).toBeInTheDocument()
      })

      const settings = await restart()
      expect(settings.lastFile).toBe('/elsewhere/standalone.md')
      expect(settings.lastFolder).toBe('')

      await waitFor(() => {
        expect(within(workspace()).getByText('standalone.md')).toBeInTheDocument()
      })
      // A je i otevřený v editoru, ne jen vypsaný v panelu.
      await waitFor(() => {
        expect(editor().value).toContain('Opened on its own.')
      })
    })

    it('zavření složky ji i zapomene', async () => {
      const user = userEvent.setup()
      await openTheFolder(user)
      // Nejdřív se opravdu zapamatovala -- jinak by test prošel i tehdy,
      // kdyby se nikdy nic neukládalo.
      await waitFor(async () => {
        expect((await vault.loadSettings()).lastFolder).toBe('/docs')
      })
      await user.click(within(workspace()).getByRole('button', { name: 'Zavřít složku' }))

      const settings = await restart()
      expect(settings.lastFolder).toBe('')
      expect(within(workspace()).queryByRole('tree')).not.toBeInTheDocument()
    })

    it('mlčky přejde cestu, která už neexistuje', async () => {
      // Nastavení přenesené z jiného počítače: cesta v něm nic neznamená.
      cleanup()
      renderApp({ lastFolder: '/tohle/tady/neni' })
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(within(workspace()).queryByRole('tree')).not.toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      // A zapomene se, aby to nezkoušela znovu při každém startu.
      await waitFor(async () => {
        expect((await vault.loadSettings()).lastFolder).toBe('')
      })
    })
  })
})
