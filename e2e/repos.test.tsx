/**
 * End-to-end: výběr repozitáře na GitHubu.
 *
 * Celá cesta, kterou uživatel čeká: přihlásím se → vidím svoje repozitáře →
 * jeden vyberu → otevře se jako složka. Jede proti `MemoryGit`, který vrací
 * tvar REST z `gh api` a průběh klonování s návraty vozíku, takže se tu
 * procházejí stejné parsery jako v aplikaci.
 */

import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { App } from '@/App'
import { MemoryGit, type MemoryGitOptions } from '@/git'
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
  'Je v trezoru.',
  '',
].join('\n')

/** Soubory, které „vzniknou“ po naklonování. */
const EXTERNAL_FILES = {
  '/dev/pilcrow/README.md': '# Pilcrow\n\nČtečka Markdownu.\n',
  '/dev/pilcrow/docs/guide.md': '# Guide\n\nJak na to.\n',
  '/dev/things-3/README.md': '# Notes\n\nStarší projekt.\n',
  // Co bude ve složce po stažení `rozpocet`.
  '/dev/rozpocet/README.md': '# Rozpočet\n\nČerstvě stažené.\n',
  '/jinde/rozpocet/README.md': '# Rozpočet\n\nStaženo jinam.\n',
  // Soubory k repozitáři `pilcrow`, které má uživatel mimo jeho kopii.
  '/moje/docs/guide.md': '# Guide\n\nMoje verze.\n',
  '/moje/docs/novy.md': '# Nový\n\nJen u mě.\n',
  // Druhá kopie `pilcrow`, stažená kdysi jinde.
  '/jinde/pilcrow/README.md': '# Pilcrow\n\nStarší kopie.\n',
  // Kopie úplně jiného repozitáře.
  '/cizi/README.md': '# Cizí\n',
}

const REPOS = [
  { fullName: 'myspulin24/pilcrow', description: 'Čtečka Markdownu', language: 'TypeScript', sizeKb: 1667 },
  { fullName: 'myspulin24/Notes_MJ', description: 'Osobní plánovač', language: 'TypeScript', sizeKb: 873 },
  { fullName: 'myspulin24/rozpocet', description: null as never, language: null as never, sizeKb: 620, private: true },
  { fullName: 'cizi-org/dokumentace', description: 'Cizí repo', language: 'Markdown', sizeKb: 40, canPush: false },
]

let vault: MemoryVault
let git: MemoryGit

type User = ReturnType<typeof userEvent.setup>

/**
 * @param folderPicks Co uživatel vybere v dialozích „kam stáhnout“ a „kde
 *   máš soubory“, jeden po druhém. `null` = dialog zavřel.
 */
async function renderApp(
  options: MemoryGitOptions = {},
  settings: Partial<VaultSettings> = {},
  folderPicks: Array<string | null> = ['/dev'],
) {
  vault = new MemoryVault({
    seed: { 'poznamka-z-trezoru.md': VAULT_NOTE },
    label: 'Testovací trezor',
    externalFiles: EXTERNAL_FILES,
    settings: { reposFolder: '/dev', ...settings },
    folderPicks,
  })
  git = new MemoryGit({
    repos: REPOS,
    // `things-3` je repo `Notes_MJ` -- jméno složky se schválně liší.
    clones: {
      '/dev/pilcrow': 'https://github.com/myspulin24/pilcrow.git',
      '/dev/things-3': 'https://github.com/myspulin24/Notes_MJ.git',
    },
    repoRoot: '/dev/pilcrow',
    ...options,
  })
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
const dialog = () => screen.getByRole('dialog', { name: 'Otevřít repozitář' })

/**
 * Jména otevřených složek v levém sloupci.
 *
 * Ne `getByText(jméno)`: jméno aktivní složky je i v hlavičce sekce Git,
 * takže by hledání podle textu našlo dvě místa.
 */
const openFolderNames = () =>
  [...workspace().querySelectorAll('[id^="ws-files-"] .ws-section__label')].map(
    (node) => node.textContent ?? '',
  )

async function openDialog(user: User) {
  await user.click(within(workspace()).getByRole('button', { name: 'Otevřít repozitář...' }))
  return screen.findByRole('dialog', { name: 'Otevřít repozitář' })
}

/** Řádek repozitáře podle jména. */
function row(name: string): HTMLElement {
  const found = within(dialog())
    .getAllByRole('listitem')
    .find((item) => item.textContent?.includes(name))
  if (!found) throw new Error(`řádek ${name} v seznamu není`)
  return found
}

afterEach(() => {
  cleanup()
})

describe('vstupní bod', () => {
  it('tlačítko je vidět i bez otevřené složky', async () => {
    await renderApp()
    // Přesně to, co chybělo: funkce musí být k nalezení hned po startu.
    expect(within(workspace()).getByRole('button', { name: 'Otevřít repozitář...' })).toBeInTheDocument()
  })

  it('vypíše repozitáře i s popisem, jazykem a velikostí', async () => {
    const user = userEvent.setup()
    await renderApp()
    await openDialog(user)

    await waitFor(() => {
      expect(within(dialog()).getAllByRole('listitem')).toHaveLength(4)
    })
    expect(row('myspulin24/pilcrow')).toHaveTextContent('Čtečka Markdownu')
    expect(row('myspulin24/pilcrow')).toHaveTextContent('TypeScript')
    expect(row('myspulin24/pilcrow')).toHaveTextContent('1,6 MB')
    expect(within(dialog()).getByText('Přihlášen jako tester')).toBeInTheDocument()
  })

  it('označí soukromé a to, kam se nedá zapisovat', async () => {
    const user = userEvent.setup()
    await renderApp()
    await openDialog(user)
    await waitFor(() => expect(within(dialog()).getAllByRole('listitem')).toHaveLength(4))

    expect(row('myspulin24/rozpocet')).toHaveTextContent('soukromé')
    // Bez práva zápisu by odeslání spadlo až na pushi -- musí to být vidět teď.
    expect(row('cizi-org/dokumentace')).toHaveTextContent('jen ke čtení')
    expect(row('myspulin24/pilcrow')).not.toHaveTextContent('jen ke čtení')
  })
})

describe('co už je na disku', () => {
  it('pozná naklonované podle remote, ne podle jména složky', async () => {
    const user = userEvent.setup()
    await renderApp()
    await openDialog(user)
    await waitFor(() => expect(within(dialog()).getAllByRole('listitem')).toHaveLength(4))

    // `/dev/things-3` je repo `Notes_MJ`. Podle jména by se nespárovalo.
    expect(row('myspulin24/Notes_MJ')).toHaveTextContent('na disku')
    expect(row('myspulin24/Notes_MJ')).toHaveTextContent('/dev/things-3')
    expect(within(row('myspulin24/Notes_MJ')).getByRole('button', { name: 'Otevřít' })).toBeInTheDocument()

    // Co na disku není, se nabídne ke stažení.
    expect(row('myspulin24/rozpocet')).not.toHaveTextContent('na disku')
    expect(within(row('myspulin24/rozpocet')).getByRole('button', { name: 'Stáhnout' })).toBeInTheDocument()
  })

  it('naklonované jsou nahoře', async () => {
    const user = userEvent.setup()
    await renderApp()
    await openDialog(user)
    await waitFor(() => expect(within(dialog()).getAllByRole('listitem')).toHaveLength(4))

    const names = within(dialog())
      .getAllByRole('listitem')
      .map((item) => item.querySelector('.repos__name')?.textContent)
    expect(names.slice(0, 2).sort()).toEqual(['myspulin24/Notes_MJ', 'myspulin24/pilcrow'])
  })

  it('otevře naklonovaný repozitář jako složku a zavře dialog', async () => {
    const user = userEvent.setup()
    await renderApp()
    await openDialog(user)
    await waitFor(() => expect(within(dialog()).getAllByRole('listitem')).toHaveLength(4))

    await user.click(within(row('myspulin24/pilcrow')).getByRole('button', { name: 'Otevřít' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Otevřít repozitář' })).toBeNull()
    })
    // Strom je otevřený a je v něm obsah repozitáře.
    await waitFor(() => {
      expect(within(workspace()).getByRole('tree')).toBeInTheDocument()
    })
    expect(openFolderNames()).toContain('pilcrow')
  })
})

describe('hledání', () => {
  it('filtruje podle jména, popisu i jazyka a nezajímá ho diakritika', async () => {
    const user = userEvent.setup()
    await renderApp()
    await openDialog(user)
    await waitFor(() => expect(within(dialog()).getAllByRole('listitem')).toHaveLength(4))

    const search = within(dialog()).getByLabelText('Hledat repozitář')
    await user.type(search, 'planovac')
    await waitFor(() => {
      expect(within(dialog()).getAllByRole('listitem')).toHaveLength(1)
    })
    expect(within(dialog()).getByText('myspulin24/Notes_MJ')).toBeInTheDocument()

    await user.clear(search)
    await user.type(search, 'nic takového')
    expect(await within(dialog()).findByText('Žádný repozitář neodpovídá hledání.')).toBeInTheDocument()
  })
})

describe('stažení', () => {
  it('zeptá se, kam stáhnout, začne ve výchozí složce a stáhne pod jménem repozitáře', async () => {
    const user = userEvent.setup()
    await renderApp()
    await openDialog(user)
    await waitFor(() => expect(within(dialog()).getAllByRole('listitem')).toHaveLength(4))

    await user.click(within(row('myspulin24/rozpocet')).getByRole('button', { name: 'Stáhnout' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Otevřít repozitář' })).toBeNull()
    })
    // Zeptalo se -- a začalo tam, kam se stahuje obvykle.
    expect(vault.folderDialogs).toEqual([{ title: 'Kam stáhnout myspulin24/rozpocet', defaultPath: '/dev' }])
    // Do vybrané složky, pod jménem repozitáře -- ne pod `owner/name`.
    expect(git.cloned).toEqual({
      repo: 'myspulin24/rozpocet',
      parent: '/dev',
      folder: 'rozpocet',
      target: '/dev/rozpocet',
    })
    // A rovnou se otevřela, takže uživatel nemusí hledat, kam se to uložilo.
    await waitFor(() => {
      expect(openFolderNames()).toContain('rozpocet')
    })
  })

  it('ukazatel průběhu čte procenta z výstupu s návraty vozíku', async () => {
    const user = userEvent.setup()
    await renderApp({ holdClone: true })
    await openDialog(user)
    await waitFor(() => expect(within(dialog()).getAllByRole('listitem')).toHaveLength(4))

    await user.click(within(row('myspulin24/rozpocet')).getByRole('button', { name: 'Stáhnout' }))

    // Git posílá průběh na jednom řádku oddělený `\r`; platí poslední úsek.
    const bar = await within(dialog()).findByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '50')
    expect(within(dialog()).getByText(/Stahuji myspulin24\/rozpocet/)).toBeInTheDocument()
    expect(within(dialog()).getByText(/Stahuji$|— Stahuji/)).toBeTruthy()

    await act(async () => {
      git.finishClone?.()
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Otevřít repozitář' })).toBeNull()
    })
  })

  it('neúspěšné stažení to řekne a dialog nechá otevřený', async () => {
    const user = userEvent.setup()
    await renderApp({ failClone: 'remote: Repository not found.' })
    await openDialog(user)
    await waitFor(() => expect(within(dialog()).getAllByRole('listitem')).toHaveLength(4))

    await user.click(within(row('myspulin24/rozpocet')).getByRole('button', { name: 'Stáhnout' }))

    await waitFor(() => {
      expect(within(dialog()).getByRole('alert')).toHaveTextContent('Repository not found')
    })
    expect(within(workspace()).queryByRole('tree')).toBeNull()
  })

  it('ptá se pokaždé -- a jiná složka se zapamatuje pro příště', async () => {
    const user = userEvent.setup()
    await renderApp({}, {}, ['/jinde'])
    await openDialog(user)
    await waitFor(() => expect(within(dialog()).getAllByRole('listitem')).toHaveLength(4))

    await user.click(within(row('myspulin24/rozpocet')).getByRole('button', { name: 'Stáhnout' }))

    await waitFor(() => expect(git.cloned?.target).toBe('/jinde/rozpocet'))
    await waitFor(async () => {
      const settings = await vault.loadSettings()
      // Příští dialog „kam“ začne tady...
      expect(settings.reposFolder).toBe('/jinde')
      // ...a repozitář se najde, i když leží mimo výchozí složku.
      expect(settings.repoFolders['myspulin24/rozpocet']).toBe('/jinde/rozpocet')
    })

    await openDialog(user)
    await waitFor(() => expect(row('myspulin24/rozpocet')).toHaveTextContent('na disku'))
    expect(row('myspulin24/rozpocet')).toHaveTextContent('/jinde/rozpocet')
  })

  it('zavřený dialog „kam“ nestáhne nic', async () => {
    const user = userEvent.setup()
    await renderApp({}, {}, [null])
    await openDialog(user)
    await waitFor(() => expect(within(dialog()).getAllByRole('listitem')).toHaveLength(4))

    await user.click(within(row('myspulin24/rozpocet')).getByRole('button', { name: 'Stáhnout' }))

    await waitFor(() => expect(vault.folderDialogs).toHaveLength(1))
    expect(git.cloned).toBeNull()
    expect(dialog()).toBeInTheDocument()
  })

  it('bez výchozí složky se stahovat dá, jen se začne odnikud', async () => {
    const user = userEvent.setup()
    await renderApp({}, { reposFolder: '' })
    await openDialog(user)

    expect(await within(dialog()).findByText('Výchozí složka pro repozitáře není vybraná.')).toBeInTheDocument()
    expect(within(dialog()).getByRole('button', { name: 'Vybrat složku...' })).toBeInTheDocument()
    // Bez složky se nedá poznat, co už na disku je.
    await waitFor(() => expect(within(dialog()).getAllByRole('listitem')).toHaveLength(4))
    expect(row('myspulin24/pilcrow')).not.toHaveTextContent('na disku')

    await user.click(within(row('myspulin24/rozpocet')).getByRole('button', { name: 'Stáhnout' }))
    await waitFor(() => expect(git.cloned?.parent).toBe('/dev'))
    expect(vault.folderDialogs[0]?.defaultPath).toBeUndefined()
  })
})

describe('GitHub CLI', () => {
  it('bez přihlášení nabídne přihlášení a ukáže jednorázový kód', async () => {
    const user = userEvent.setup()
    await renderApp({ loggedIn: false })
    await openDialog(user)

    expect(await within(dialog()).findByText('Přihlas se k GitHubu')).toBeInTheDocument()
    expect(within(dialog()).queryByRole('list')).toBeNull()

    await user.click(within(dialog()).getByRole('button', { name: 'Přihlásit se k GitHubu' }))
    expect(await within(dialog()).findByLabelText('Jednorázový kód')).toHaveTextContent('D394-D2F5')

    // Po přihlášení se seznam načte sám.
    await act(async () => {
      git.completeLogin()
    })
    await waitFor(() => {
      expect(within(dialog()).getAllByRole('listitem')).toHaveLength(4)
    })
  })

  it('bez gh řekne, co chybí, a seznam nenabízí', async () => {
    const user = userEvent.setup()
    await renderApp({ ghInstalled: false })
    await openDialog(user)

    expect(await within(dialog()).findByText('Je potřeba GitHub CLI')).toBeInTheDocument()
    expect(within(dialog()).getByText(/winget install --id GitHub\.cli/)).toBeInTheDocument()
    expect(within(dialog()).queryByRole('list')).toBeNull()
  })
})

describe('otevření už staženého repozitáře', () => {
  /** Otevřít `pilcrow`, který je ve výchozím nastavení na disku. */
  async function openCloned(user: User) {
    await openDialog(user)
    await waitFor(() => expect(within(dialog()).getAllByRole('listitem')).toHaveLength(4))
    await user.click(within(row('myspulin24/pilcrow')).getByRole('button', { name: 'Otevřít' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Otevřít repozitář' })).toBeNull()
    })
  }

  it('když je na GitHubu něco nového, zeptá se odkud stáhnout -- samo nestáhne nic', async () => {
    const user = userEvent.setup()
    await renderApp({ behind: 3 })
    await openCloned(user)

    await waitFor(() => expect(git.syncCalls).toBeGreaterThan(0))
    const ask = await screen.findByRole('dialog', { name: 'Stáhnout z GitHubu' })
    // Otázka, ne čin: dokud uživatel nevybere, nestáhlo se nic.
    expect(git.pulled).toBe(false)
    await within(ask).findByRole('button', { name: 'Stáhnout do main' })
    const list = within(ask).getByRole('list', { name: 'Větve' })
    expect(within(list).getByText('3 ke stažení')).toBeInTheDocument()

    await user.click(within(ask).getByRole('button', { name: 'Stáhnout do main' }))
    await waitFor(() => expect(git.pulled).toBe(true))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Stáhnout z GitHubu' })).toBeNull())
  })

  it('když je složka aktuální, na nic se neptá a nestahuje nic', async () => {
    const user = userEvent.setup()
    await renderApp({ behind: 0 })
    await openCloned(user)

    await waitFor(() => expect(git.syncCalls).toBeGreaterThan(0))
    expect(git.pulled).toBe(false)
    expect(screen.queryByRole('dialog', { name: 'Stáhnout z GitHubu' })).toBeNull()
  })

  it('otázku jde zavřít a nestáhne se nic', async () => {
    const user = userEvent.setup()
    await renderApp({ behind: 2 })
    await openCloned(user)

    const ask = await screen.findByRole('dialog', { name: 'Stáhnout z GitHubu' })
    await user.click(within(ask).getByRole('button', { name: 'Zavřít' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Stáhnout z GitHubu' })).toBeNull())
    expect(git.pulled).toBe(false)
    // Stáhnout jde dál ze sekce Git, zase přes otázku.
    const body = document.getElementById('ws-git-body') as HTMLElement
    await user.click(within(body).getByRole('button', { name: 'Stáhnout…' }))
    expect(await screen.findByRole('dialog', { name: 'Stáhnout z GitHubu' })).toBeInTheDocument()
    expect(git.pulled).toBe(false)
  })

  it('rozdělanou práci nepřepíše -- nabídne to a čeká', async () => {
    const user = userEvent.setup()
    await renderApp({ behind: 2, changes: [{ path: 'docs/guide.md', xy: ' M' }] })
    await openCloned(user)

    await waitFor(() => expect(git.syncCalls).toBeGreaterThan(0))
    // Nic se nestáhlo samo...
    expect(git.pulled).toBe(false)
    // ...a je napsáno proč.
    const body = document.getElementById('ws-git-body') as HTMLElement
    expect(await within(body).findByText(/Nejdřív ulož nebo odešli/)).toBeInTheDocument()
  })

  it('rozešlé větve nechá na uživateli', async () => {
    const user = userEvent.setup()
    await renderApp({ behind: 2, ahead: 1 })
    await openCloned(user)

    await waitFor(() => expect(git.syncCalls).toBeGreaterThan(0))
    expect(git.pulled).toBe(false)
    const body = document.getElementById('ws-git-body') as HTMLElement
    expect(await within(body).findByText(/Větve se rozešly/)).toBeInTheDocument()
  })

  it('bez sítě se nestahuje a nic se netvrdí', async () => {
    const user = userEvent.setup()
    await renderApp({ behind: 5, failSync: 'could not resolve host github.com' })
    await openCloned(user)

    await waitFor(() => expect(git.syncCalls).toBeGreaterThan(0))
    expect(git.pulled).toBe(false)
    const body = document.getElementById('ws-git-body') as HTMLElement
    expect(within(body).queryByText(/novější commit/)).toBeNull()
  })
})

describe('soubory mám jinde', () => {
  const linkButton = (name: string) => within(row(name)).getByRole('button', { name: 'Soubory mám jinde…' })

  it('obyčejná složka se po potvrzení napojí a hned se ukáže, čím se liší od main', async () => {
    const user = userEvent.setup()
    await renderApp(
      {
        linkChanges: [
          { path: 'guide.md', xy: ' M' },
          { path: 'README.md', xy: ' D' },
          { path: 'novy.md', xy: '??' },
        ],
      },
      {},
      ['/moje/docs'],
    )
    await openDialog(user)
    await waitFor(() => expect(within(dialog()).getAllByRole('listitem')).toHaveLength(4))

    await user.click(linkButton('myspulin24/pilcrow'))

    // Napřed se ptá, kde soubory jsou...
    expect(vault.folderDialogs[0]?.title).toBe('Kde máš soubory k myspulin24/pilcrow?')
    // ...a pak řekne, co se stane, a počká na potvrzení.
    const card = await within(dialog()).findByLabelText('Napojit složku na repozitář')
    expect(card).toHaveTextContent('/moje/docs')
    expect(card).toHaveTextContent('Soubory v ní zůstanou, jak jsou')
    expect(git.linked).toBeNull()

    await user.click(within(card).getByRole('button', { name: 'Napojit' }))

    await waitFor(() => {
      expect(git.linked).toEqual({
        folder: '/moje/docs',
        remoteUrl: 'https://github.com/myspulin24/pilcrow.git',
        defaultBranch: 'main',
      })
    })
    // Výběr repozitáře zmizí, otevře se napojená složka a porovnání s main.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Otevřít repozitář' })).toBeNull())
    await waitFor(() => expect(openFolderNames()).toContain('docs'))
    const compare = await screen.findByRole('dialog', { name: 'Porovnání s main' })
    const files = await within(compare).findByRole('list', { name: 'Rozdílné soubory' })
    expect(within(files).getByText('guide.md').closest('li')).toHaveTextContent('liší se')
    expect(within(files).getByText('README.md').closest('li')).toHaveTextContent('chybí u tebe')
    expect(within(files).getByText('novy.md').closest('li')).toHaveTextContent('jen u tebe')
    expect(within(compare).getByText('Odeslat rozdíly na GitHub')).toBeInTheDocument()
    expect(within(compare).getByText('Vrátit soubory na verzi z main')).toBeInTheDocument()

    // Zapamatuje se: příště je zdrojem souborů tahle složka, ne ta stará kopie.
    await waitFor(async () => {
      expect((await vault.loadSettings()).repoFolders['myspulin24/pilcrow']).toBe('/moje/docs')
    })
    await user.click(within(compare).getByRole('button', { name: 'Nechat, jak to je' }))
    await openDialog(user)
    await waitFor(() => expect(row('myspulin24/pilcrow')).toHaveTextContent('/moje/docs'))
  })

  it('kopii jiného repozitáře nenapojí a řekne proč', async () => {
    const user = userEvent.setup()
    await renderApp(
      { folders: { '/cizi': { root: '/cizi', remote: 'https://github.com/nekdo/jiny.git' } } },
      {},
      ['/cizi'],
    )
    await openDialog(user)
    await waitFor(() => expect(within(dialog()).getAllByRole('listitem')).toHaveLength(4))

    await user.click(linkButton('myspulin24/pilcrow'))

    const card = await within(dialog()).findByLabelText('Napojit složku na repozitář')
    expect(within(card).getByRole('alert')).toHaveTextContent('nekdo/jiny')
    expect(within(card).queryByRole('button', { name: 'Napojit' })).toBeNull()

    await user.click(within(card).getByRole('button', { name: 'Zpět' }))
    await waitFor(() => expect(within(dialog()).getAllByRole('listitem')).toHaveLength(4))
    expect(git.linked).toBeNull()
  })

  it('kopii téhož repozitáře jen začne používat, nic nezakládá', async () => {
    const user = userEvent.setup()
    await renderApp(
      {
        folders: { '/jinde/pilcrow': { root: '/jinde/pilcrow', remote: 'git@github.com:myspulin24/pilcrow.git' } },
      },
      {},
      ['/jinde/pilcrow'],
    )
    await openDialog(user)
    await waitFor(() => expect(within(dialog()).getAllByRole('listitem')).toHaveLength(4))

    await user.click(linkButton('myspulin24/pilcrow'))

    // Žádné potvrzení: není co měnit.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Otevřít repozitář' })).toBeNull())
    expect(git.linked).toBeNull()
    await waitFor(() => expect(openFolderNames()).toContain('pilcrow'))
    expect(await screen.findByRole('dialog', { name: 'Porovnání s main' })).toBeInTheDocument()
    await waitFor(async () => {
      expect((await vault.loadSettings()).repoFolders['myspulin24/pilcrow']).toBe('/jinde/pilcrow')
    })
  })

  it('když napojení selže, řekne to a nic neotevře', async () => {
    const user = userEvent.setup()
    await renderApp({ failLink: 'fatal: repository not found' }, {}, ['/moje/docs'])
    await openDialog(user)
    await waitFor(() => expect(within(dialog()).getAllByRole('listitem')).toHaveLength(4))

    await user.click(linkButton('myspulin24/pilcrow'))
    const card = await within(dialog()).findByLabelText('Napojit složku na repozitář')
    await user.click(within(card).getByRole('button', { name: 'Napojit' }))

    await waitFor(() => expect(within(dialog()).getByRole('alert')).toHaveTextContent('repository not found'))
    expect(openFolderNames()).not.toContain('docs')
    expect((await vault.loadSettings()).repoFolders['myspulin24/pilcrow']).toBeUndefined()
  })
})
