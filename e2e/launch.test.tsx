/**
 * End-to-end: soubor, se kterým někdo Pilcrow spustil.
 *
 * Tak se do aplikace dostane zápis ze schůzky, který v ní chce otevřít jiný
 * program (`Pilcrow.exe cesta.md`), i soubor otevřený dvojklikem. Co je
 * v argumentech soubor a co ne, testuje Rust v
 * `src-tauri/crates/pilcrow-core/src/launch.rs`; tady jde o to, co s ním
 * udělá okno:
 *
 *  - ukáže ho v editoru hned po startu, přednostně před tím, co se obnovilo,
 *  - nezavře kvůli němu složky otevřené minule,
 *  - soubor od druhého spuštění otevře, i když se v editoru zrovna píše,
 *  - a nic z toho se neztratí jen proto, že přišlo dřív, než okno poslouchalo.
 */

import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { App } from '@/App'
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

const MEETING = '/zapisy/2026-09-29-1306.md'

const EXTERNAL_FILES = {
  [MEETING]: '# Schůzka 29. 9.\n\nZápis z nahrávky.\n',
  '/zapisy/2026-09-28-0900.md': '# Schůzka 28. 9.\n\nStarší zápis.\n',
  '/repo/README.md': '# Repozitář\n',
  '/repo/docs/navod.md': '# Návod\n\nUvnitř otevřené složky.\n',
  '/jinde/minule.md': '# Minule\n\nNaposledy otevřený soubor.\n',
}

let vault: MemoryVault

async function renderApp(
  options: { settings?: Partial<VaultSettings>; launchFiles?: string[]; beforeRender?: () => void } = {},
) {
  vault = new MemoryVault({
    seed: { 'poznamka.md': VAULT_NOTE },
    label: 'Testovací trezor',
    externalFiles: EXTERNAL_FILES,
    externalRoot: '/repo',
    ...(options.settings ? { settings: options.settings } : {}),
    ...(options.launchFiles ? { launchFiles: options.launchFiles } : {}),
  })
  options.beforeRender?.()
  render(
    <StoreProvider vault={vault}>
      <App />
    </StoreProvider>,
  )
  await settle()
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const workspace = () => screen.getByLabelText('Pracovní plocha')
const editor = () => screen.getByLabelText('Text poznámky') as HTMLTextAreaElement
const noteHeader = () => screen.getByLabelText('Hlavička poznámky')
/** Samostatně otevřený soubor v panelu, nebo `null`, když tam žádný není. */
function loneFile(): string | null {
  const list = within(workspace()).queryByRole('list', { name: 'Otevřený soubor' })
  return list?.querySelector('[data-tree-file]')?.getAttribute('data-tree-file') ?? null
}
const openFolderNames = () =>
  [...workspace().querySelectorAll('[id^="ws-files-"] .ws-section__label')].map(
    (node) => node.textContent ?? '',
  )

afterEach(() => {
  cleanup()
})

describe('spuštění se souborem', () => {
  it('soubor je hned v editoru a v panelu, místo první poznámky', async () => {
    await renderApp({ launchFiles: [MEETING] })

    await waitFor(() => {
      expect(within(noteHeader()).getByRole('heading')).toHaveTextContent('2026-09-29-1306.md')
    })
    expect(editor().value).toBe(EXTERNAL_FILES[MEETING])
    expect(within(noteHeader()).getByText('externí soubor')).toBeInTheDocument()
    expect(loneFile()).toBe(MEETING)
  })

  it('má přednost před souborem otevřeným minule', async () => {
    await renderApp({ settings: { lastFile: '/jinde/minule.md' }, launchFiles: [MEETING] })

    await waitFor(() => expect(editor().value).toBe(EXTERNAL_FILES[MEETING]))
    expect(loneFile()).toBe(MEETING)
    // A zapamatuje se místo něj, jako by ho uživatel otevřel sám.
    await waitFor(async () => {
      expect((await vault.loadSettings()).lastFile).toBe(MEETING)
    })
  })

  it('složky otevřené minule nezavře', async () => {
    await renderApp({ settings: { openFolders: ['/repo'] }, launchFiles: [MEETING] })

    await waitFor(() => expect(editor().value).toBe(EXTERNAL_FILES[MEETING]))
    expect(openFolderNames()).toEqual(['repo'])
    expect(within(workspace()).getByRole('tree')).toBeInTheDocument()
    // Zapamatované složky zůstaly, jak byly -- příští start je otevře zase.
    await settle()
    expect((await vault.loadSettings()).openFolders).toEqual(['/repo'])
  })

  it('soubor z otevřené složky se otevře v ní', async () => {
    await renderApp({ settings: { openFolders: ['/repo'] }, launchFiles: ['/repo/docs/navod.md'] })

    await waitFor(() => expect(editor().value).toContain('Uvnitř otevřené složky.'))
    expect(openFolderNames()).toEqual(['repo'])
    // Cesta dole se počítá od složky, ve které soubor je.
    expect(workspace().querySelector('.workspace__current-path')).toHaveTextContent(/^docs\/navod\.md$/)
  })

  it('z víc souborů otevře první', async () => {
    await renderApp({ launchFiles: [MEETING, '/zapisy/2026-09-28-0900.md'] })

    await waitFor(() => expect(editor().value).toBe(EXTERNAL_FILES[MEETING]))
  })

  it('soubor, který neexistuje, přejde mlčky a otevře se to, co obvykle', async () => {
    await renderApp({ launchFiles: ['/nikde/neni.md'] })

    await waitFor(() => {
      expect(within(noteHeader()).getByRole('heading')).toHaveTextContent('Poznámka z trezoru')
    })
    expect(loneFile()).toBeNull()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('soubor, který přišel dřív, než okno poslouchalo, se neztratí', async () => {
    // Druhé spuštění ještě během startu: frontend frontu ještě nevyzvedl.
    await renderApp({ beforeRender: () => vault.simulateLaunch([MEETING]) })

    await waitFor(() => expect(editor().value).toBe(EXTERNAL_FILES[MEETING]))
  })
})

describe('druhé spuštění, když Pilcrow už běží', () => {
  it('soubor se otevře v běžícím okně', async () => {
    await renderApp()
    await waitFor(() => {
      expect(within(noteHeader()).getByRole('heading')).toHaveTextContent('Poznámka z trezoru')
    })

    act(() => vault.simulateLaunch([MEETING]))

    await waitFor(() => expect(editor().value).toBe(EXTERNAL_FILES[MEETING]))
    expect(loneFile()).toBe(MEETING)
  })

  it('otevřené složky zůstanou', async () => {
    const user = userEvent.setup()
    await renderApp()
    await user.click(within(workspace()).getByRole('button', { name: 'Otevřít složku...' }))
    await waitFor(() => expect(openFolderNames()).toEqual(['repo']))

    act(() => vault.simulateLaunch([MEETING]))

    await waitFor(() => expect(editor().value).toBe(EXTERNAL_FILES[MEETING]))
    expect(openFolderNames()).toEqual(['repo'])
  })

  it('rozepsaná poznámka se před otevřením uloží', async () => {
    const user = userEvent.setup()
    await renderApp()
    await waitFor(() => expect(editor().value).toContain('# Poznámka z trezoru'))

    await user.click(editor())
    await user.keyboard('{Control>}{End}{/Control}')
    await user.paste('\nRozepsáno těsně před nahrávkou.\n')
    // Hned, bez čekání na automatické uložení.
    act(() => vault.simulateLaunch([MEETING]))

    await waitFor(() => expect(editor().value).toBe(EXTERNAL_FILES[MEETING]))
    expect(vault.peek('poznamka.md')).toContain('Rozepsáno těsně před nahrávkou.')
  })

  it('soubor, který neexistuje, nic nezmění', async () => {
    await renderApp()
    await waitFor(() => {
      expect(within(noteHeader()).getByRole('heading')).toHaveTextContent('Poznámka z trezoru')
    })

    act(() => vault.simulateLaunch(['/nikde/neni.md', '/repo/obrazek.png']))
    await settle()

    expect(within(noteHeader()).getByRole('heading')).toHaveTextContent('Poznámka z trezoru')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
