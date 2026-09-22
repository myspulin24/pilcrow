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

async function renderApp(options: MemoryGitOptions = {}, settings: Partial<VaultSettings> = {}) {
  vault = new MemoryVault({
    seed: { 'poznamka-z-trezoru.md': VAULT_NOTE },
    label: 'Testovací trezor',
    externalFiles: EXTERNAL_FILES,
    settings: { reposFolder: '/dev', ...settings },
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
    expect(within(row('myspulin24/Notes_MJ')).getByRole('button')).toHaveTextContent('Otevřít')

    // Co na disku není, se nabídne ke stažení.
    expect(row('myspulin24/rozpocet')).not.toHaveTextContent('na disku')
    expect(within(row('myspulin24/rozpocet')).getByRole('button')).toHaveTextContent('Stáhnout')
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
  it('stáhne do vybrané složky pod jménem repozitáře a otevře ji', async () => {
    const user = userEvent.setup()
    await renderApp()
    await openDialog(user)
    await waitFor(() => expect(within(dialog()).getAllByRole('listitem')).toHaveLength(4))

    await user.click(within(row('myspulin24/rozpocet')).getByRole('button', { name: 'Stáhnout' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Otevřít repozitář' })).toBeNull()
    })
    // Do složky z nastavení, pod jménem repozitáře -- ne pod `owner/name`.
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

  it('bez vybrané složky se nejdřív zeptá, kam stahovat', async () => {
    const user = userEvent.setup()
    await renderApp({}, { reposFolder: '' })
    await openDialog(user)

    expect(await within(dialog()).findByText('Složka pro repozitáře není vybraná.')).toBeInTheDocument()
    expect(within(dialog()).getByRole('button', { name: 'Vybrat složku...' })).toBeInTheDocument()
    // Bez složky se nedá poznat, co už na disku je.
    await waitFor(() => expect(within(dialog()).getAllByRole('listitem')).toHaveLength(4))
    expect(row('myspulin24/pilcrow')).not.toHaveTextContent('na disku')
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

  it('srovná stav s GitHubem a stáhne, co přibylo', async () => {
    const user = userEvent.setup()
    await renderApp({ behind: 3 })
    await openCloned(user)

    await waitFor(() => expect(git.syncCalls).toBeGreaterThan(0))
    await waitFor(() => expect(git.pulled).toBe(true))
  })

  it('když je složka aktuální, nestahuje nic', async () => {
    const user = userEvent.setup()
    await renderApp({ behind: 0 })
    await openCloned(user)

    await waitFor(() => expect(git.syncCalls).toBeGreaterThan(0))
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
