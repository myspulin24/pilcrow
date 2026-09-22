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
import {
  SECTION_HEIGHT_MIN,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  WORKSPACE_WIDTH_DEFAULT,
  WORKSPACE_WIDTH_MAX,
  WORKSPACE_WIDTH_MIN,
} from '@/core'
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

/**
 * Postranní panel se skupinami a štítky.
 *
 * Roztahuje se stejným úchytem jako sloupec vedle něj -- jen do jiné volby
 * a v jiných mezích. Testuje se hlavně to, že se ty dvě šířky nepletou.
 */
describe('roztahování postranního panelu', () => {
  const sidebar = () => screen.getByLabelText('Skupiny a štítky')
  const railHandle = () => within(sidebar()).getByRole('button', { name: 'Šířka bočního panelu' })

  async function dragRail(dx: number) {
    await act(async () => {
      fireEvent.pointerDown(railHandle(), { clientX: 200 })
      fireEvent.pointerMove(window, { clientX: 200 + dx })
      fireEvent.pointerUp(window)
    })
  }

  it('výchozí šířka je z nastavení a promítne se do panelu', async () => {
    await renderApp({ sidebarWidth: 300 })
    expect(sidebar().style.width).toBe('300px')
  })

  it('tažení změní šířku panelu a uloží ji, sloupce vedle se nedotkne', async () => {
    await renderApp({ sidebarWidth: 220, workspaceWidth: 300 })
    await dragRail(60)

    expect(sidebar().style.width).toBe('280px')
    await waitFor(async () => {
      expect((await vault.loadSettings()).sidebarWidth).toBe(280)
    })
    expect((await vault.loadSettings()).workspaceWidth).toBe(300)
    expect(workspace().style.width).toBe('300px')
  })

  it('drží vlastní meze, ne ty od vedlejšího sloupce', async () => {
    await renderApp({ sidebarWidth: 220 })
    await dragRail(-5000)
    expect(sidebar().style.width).toBe(`${SIDEBAR_WIDTH_MIN}px`)

    await dragRail(5000)
    expect(sidebar().style.width).toBe(`${SIDEBAR_WIDTH_MAX}px`)
    // Sloupec s poznámkami má strop jinde; kdyby se meze pletly, vyšlo by tu
    // jeho maximum.
    expect(SIDEBAR_WIDTH_MAX).not.toBe(WORKSPACE_WIDTH_MAX)
  })

  it('dvojklik vrátí výchozí šířku', async () => {
    await renderApp({ sidebarWidth: 400 })
    await act(async () => {
      fireEvent.doubleClick(railHandle())
    })
    await waitFor(async () => {
      expect((await vault.loadSettings()).sidebarWidth).toBe(SIDEBAR_WIDTH_DEFAULT)
    })
  })

  it('poškozená hodnota v nastavení panel neschová', async () => {
    await renderApp({ sidebarWidth: 0 })
    expect(sidebar().style.width).toBe(`${SIDEBAR_WIDTH_DEFAULT}px`)
  })
})

describe('výšky jednotlivých bloků', () => {
  const sectionHandle = (name: RegExp) =>
    within(workspace()).getByRole('button', { name })

  async function dragSection(name: RegExp, dy: number) {
    await act(async () => {
      fireEvent.pointerDown(sectionHandle(name), { clientY: 400 })
      fireEvent.pointerMove(window, { clientY: 400 + dy })
      fireEvent.pointerUp(window)
    })
  }

  it('blok bez uložené výšky roste obsahem', async () => {
    await renderApp()
    const body = document.getElementById('ws-notes-body') as HTMLElement
    expect(body.style.height).toBe('')
    expect(body.className).not.toContain('is-sized')
  })

  it('uložená výška se na blok promítne i s vnitřním posuvníkem', async () => {
    await renderApp({ sectionHeights: { notes: 240 } })
    const body = document.getElementById('ws-notes-body') as HTMLElement
    expect(body.style.height).toBe('240px')
    expect(body.className).toContain('is-sized')
  })

  it('tažení uloží výšku jen tomu bloku, za který se táhne', async () => {
    await renderApp({ sectionHeights: { notes: 200 } })
    await dragSection(/Výška bloku Poznámky/, 120)

    await waitFor(async () => {
      expect((await vault.loadSettings()).sectionHeights).toEqual({ notes: 320 })
    })
    // Šířka sloupce se tím nedotkla.
    expect((await vault.loadSettings()).workspaceWidth).toBe(WORKSPACE_WIDTH_DEFAULT)
  })

  it('dvojklik pevnou výšku zruší a blok se vrátí k obsahu', async () => {
    await renderApp({ sectionHeights: { notes: 240 } })
    const body = document.getElementById('ws-notes-body') as HTMLElement
    expect(body.style.height).toBe('240px')

    await act(async () => {
      fireEvent.doubleClick(sectionHandle(/Výška bloku Poznámky/))
    })
    await waitFor(async () => {
      expect((await vault.loadSettings()).sectionHeights).toEqual({})
    })
    expect(body.style.height).toBe('')
    expect(body.className).not.toContain('is-sized')
  })

  it('poškozená výška v nastavení blok nezmenší pod minimum', async () => {
    await renderApp({ sectionHeights: { notes: 5 } })
    const body = document.getElementById('ws-notes-body') as HTMLElement
    expect(body.style.height).toBe(`${SECTION_HEIGHT_MIN}px`)
  })
})
