/**
 * End-to-end: roztahování levého sloupce.
 *
 * Šířka se během tažení píše přímo do DOM kvůli plynulosti, do nastavení až
 * po puštění. Test si hlídá obojí -- kdyby se ukládalo při každém pohybu,
 * zapisovalo by se na disk desetkrát za vteřinu; kdyby se neukládalo vůbec,
 * nastavení by se po restartu ztratilo.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { App } from '@/App'
import { WORKSPACE_WIDTH_DEFAULT, WORKSPACE_WIDTH_MAX, WORKSPACE_WIDTH_MIN } from '@/core'
import { StoreProvider } from '@/state/store'
import { MemoryVault, type VaultSettings } from '@/vault'

const NOTE = [
  '---',
  'id: seed0001vault',
  'title: Poznámka',
  'created: 2026-09-01T09:00:00.000Z',
  'updated: 2026-09-01T09:00:00.000Z',
  'pinned: false',
  'tags: []',
  '---',
  '',
  '# Poznámka',
  '',
].join('\n')

let vault: MemoryVault

async function renderApp(settings: Partial<VaultSettings> = {}) {
  vault = new MemoryVault({ seed: { 'poznamka.md': NOTE }, label: 'Testovací trezor', settings })
  render(
    <StoreProvider vault={vault}>
      <App />
    </StoreProvider>,
  )
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const workspace = () => screen.getByLabelText('Pracovní plocha')
const handle = () => within(workspace()).getByRole('button', { name: 'Šířka levého sloupce' })

/** Chytit úchyt a táhnout o `dx` bodů. */
async function drag(dx: number, options: { release?: boolean } = {}) {
  await act(async () => {
    fireEvent.pointerDown(handle(), { clientX: 500 })
    fireEvent.pointerMove(window, { clientX: 500 + dx })
    if (options.release !== false) fireEvent.pointerUp(window)
  })
}

afterEach(() => {
  cleanup()
})

describe('roztahování levého sloupce', () => {
  it('výchozí šířka je z nastavení a promítne se do sloupce', async () => {
    await renderApp({ workspaceWidth: 420 })
    expect(workspace().style.width).toBe('420px')
  })

  it('tažení změní šířku a po puštění se uloží', async () => {
    await renderApp({ workspaceWidth: 300 })
    await drag(120)

    expect(workspace().style.width).toBe('420px')
    await waitFor(async () => {
      expect((await vault.loadSettings()).workspaceWidth).toBe(420)
    })
  })

  it('během tažení se nic neukládá -- až po puštění', async () => {
    await renderApp({ workspaceWidth: 300 })
    await drag(80, { release: false })

    // Sloupec už je širší...
    expect(workspace().style.width).toBe('380px')
    // ...ale na disku je pořád původní hodnota.
    expect((await vault.loadSettings()).workspaceWidth).toBe(300)

    await act(async () => {
      fireEvent.pointerUp(window)
    })
    await waitFor(async () => {
      expect((await vault.loadSettings()).workspaceWidth).toBe(380)
    })
  })

  it('drží meze, i když táhneš daleko za okraj', async () => {
    await renderApp({ workspaceWidth: 300 })
    await drag(-5000)
    expect(workspace().style.width).toBe(`${WORKSPACE_WIDTH_MIN}px`)

    await drag(5000)
    expect(workspace().style.width).toBe(`${WORKSPACE_WIDTH_MAX}px`)
  })

  it('jde i z klávesnice a dvojklik vrátí výchozí šířku', async () => {
    const user = userEvent.setup()
    await renderApp({ workspaceWidth: 300 })

    handle().focus()
    await user.keyboard('{ArrowRight}')
    await waitFor(async () => {
      expect((await vault.loadSettings()).workspaceWidth).toBe(310)
    })
    await user.keyboard('{ArrowLeft}')
    await waitFor(async () => {
      expect((await vault.loadSettings()).workspaceWidth).toBe(300)
    })

    await drag(200)
    await waitFor(async () => {
      expect((await vault.loadSettings()).workspaceWidth).toBe(500)
    })
    await act(async () => {
      fireEvent.doubleClick(handle())
    })
    await waitFor(async () => {
      expect((await vault.loadSettings()).workspaceWidth).toBe(WORKSPACE_WIDTH_DEFAULT)
    })
  })

  it('poškozená hodnota v nastavení sloupec neschová', async () => {
    // Nastavení se dá upravit ručně i přenést z jiného počítače.
    await renderApp({ workspaceWidth: 0 })
    expect(workspace().style.width).toBe(`${WORKSPACE_WIDTH_DEFAULT}px`)
  })
})
