/**
 * End-to-end happy path.
 *
 * This drives the real `<App />` through the DOM -- the same components,
 * reducer, keyboard handling and core transformation the desktop app runs --
 * backed by the in-memory vault adapter instead of Rust. That keeps it fast
 * and hermetic while still exercising the whole stack above the file system;
 * the file system itself is covered by the Rust tests in
 * `src-tauri/crates/pilcrow-core`.
 *
 * The path it walks is the product in one sentence: write a tagged note, link
 * it to another, see the backlink, find it by search, and export the folder.
 */

import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { App } from '@/App'
import { parseNote } from '@/core'
import { StoreProvider } from '@/state/store'
import { MemoryVault } from '@/vault'

let vault: MemoryVault

function renderApp() {
  vault = new MemoryVault({
    seed: {
      'seznam-ke-cteni.md': [
        '---',
        'id: seed0001reading',
        'title: Seznam ke čtení',
        'created: 2026-09-01T09:00:00.000Z',
        'updated: 2026-09-01T09:00:00.000Z',
        'pinned: false',
        'tags: [knihy]',
        '---',
        '',
        '# Seznam ke čtení',
        '',
        'Knihy, které chci přečíst.',
        '',
      ].join('\n'),
    },
    label: 'Testovací trezor',
  })
  return render(
    <StoreProvider vault={vault}>
      <App />
    </StoreProvider>,
  )
}

/** The note body textarea. */
const editor = () => screen.getByLabelText('Text poznámky') as HTMLTextAreaElement

/**
 * Wait until the note with this title is the one open.
 *
 * Scoped to the note header on purpose: the preview renders the note's own
 * `# Heading` as an <h1> as well, so an unscoped heading query is ambiguous.
 */
async function waitForOpenNote(title: RegExp) {
  await waitFor(async () => {
    const header = await screen.findByLabelText('Hlavička poznámky')
    expect(within(header).getByRole('heading')).toHaveTextContent(title)
  })
}

/** Wait for the debounced autosave to land on disk. */
async function waitForSave(path: string, contains: string) {
  await waitFor(
    () => {
      expect(vault.peek(path) ?? '').toContain(contains)
    },
    { timeout: 5000 },
  )
}

beforeEach(async () => {
  renderApp()
  // The store boots asynchronously: status -> settings -> note list -> open
  // the first note. Let that chain settle inside act() so the updates it
  // produces are not reported as happening outside React's control.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
})

afterEach(() => {
  cleanup()
})

describe('the core loop', () => {
  it('writes a tagged note, links it, shows the backlink, finds it and exports', async () => {
    const user = userEvent.setup()

    // --- the app opens on the existing note -------------------------------
    await waitForOpenNote(/Seznam ke čtení/)
    expect(editor().value).toContain('Knihy, které chci přečíst.')

    // --- create a note ----------------------------------------------------
    await user.keyboard('{Control>}n{/Control}')

    const nameField = await screen.findByLabelText('Název')
    await user.type(nameField, 'Projekt Aurora')
    await user.click(screen.getByRole('button', { name: 'Vytvořit' }))

    await waitFor(() => {
      expect(vault.paths()).toContain('Projekt Aurora.md')
    })
    await waitForOpenNote(/Projekt Aurora/)

    // --- write tagged Markdown with a wiki link ---------------------------
    const body = [
      '# Projekt Aurora',
      '',
      'Start je příští týden. #práce/aurora',
      '',
      'Nejdřív ke čtení: [[Seznam ke čtení]]',
      '',
      '- [ ] připravit zadání',
      '- [x] zamluvit místnost',
      '',
      '| Fáze | Odpovědný |',
      '| --- | --- |',
      '| Návrh | Míša |',
    ].join('\n')

    await user.clear(editor())
    await user.paste(body)

    // --- it is written to the vault as plain Markdown ---------------------
    await waitForSave('Projekt Aurora.md', 'Start je příští týden.')

    const saved = vault.peek('Projekt Aurora.md')!
    const parsed = parseNote(saved, { path: 'Projekt Aurora.md' })
    expect(parsed.frontmatter.title).toBe('Projekt Aurora')
    expect(parsed.tags).toContain('práce/aurora')
    expect(parsed.links.map((link) => link.target)).toContain('Seznam ke čtení')
    expect(parsed.tasks).toEqual({ total: 2, done: 1 })

    // --- the preview renders tasks, tables, tags and links ----------------
    const preview = screen.getByLabelText('Náhled')
    await waitFor(() => {
      expect(preview.querySelectorAll('input[type="checkbox"]')).toHaveLength(2)
    })
    expect(preview.querySelector('table')).not.toBeNull()
    expect(preview.querySelector('[data-tag="práce/aurora"]')).not.toBeNull()
    expect(preview.querySelector('[data-wikilink="Seznam ke čtení"]')).not.toBeNull()

    // --- the tag filters the list when clicked in the preview -------------
    // Strom štítků v panelu skončil v 0.11; klik na štítek v náhledu zůstal
    // jediným způsobem, jak se k filtru dostat myší, takže se testuje ten.
    await user.click(preview.querySelector('[data-tag="práce/aurora"]') as HTMLElement)
    await waitFor(() => {
      expect(screen.getByText(/Filtrováno štítkem/)).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: 'Zrušit' }))

    // --- following the link opens the other note, which shows the backlink -
    await user.click(preview.querySelector('[data-wikilink="Seznam ke čtení"]') as HTMLElement)

    await waitForOpenNote(/Seznam ke čtení/)
    const backlinks = screen.getByLabelText('Zpětné odkazy')
    await waitFor(() => {
      expect(within(backlinks).getByText('1 zmínka')).toBeInTheDocument()
      expect(within(backlinks).getByText('Projekt Aurora')).toBeInTheDocument()
    })

    // --- search finds it instantly ----------------------------------------
    const search = screen.getByLabelText('Hledat v poznámkách a souborech')
    await user.type(search, 'aurora')

    // Re-query the list each time: it unmounts while a search is in flight,
    // so a node captured beforehand would be detached.
    const noteList = () => within(screen.getByLabelText('Poznámky'))
    await waitFor(() => {
      expect(noteList().getByText('Projekt Aurora')).toBeInTheDocument()
      expect(noteList().queryByText('Seznam ke čtení')).not.toBeInTheDocument()
    })

    // --- and so does a tag filter -----------------------------------------
    await user.clear(search)
    await user.type(search, 'štítek:práce/aurora')
    await waitFor(() => {
      expect(noteList().getByText('Projekt Aurora')).toBeInTheDocument()
    })

    // --- export reports what it wrote -------------------------------------
    await user.clear(search)
    await user.click(screen.getByRole('button', { name: 'Export' }))
    await waitFor(() => {
      expect(screen.getByText(/Exportováno 2 soubory/)).toBeInTheDocument()
    })
  })

  it('renames a note and rewrites the links that pointed at it', async () => {
    const user = userEvent.setup()
    await waitForOpenNote(/Seznam ke čtení/)

    // A second note that links to the first.
    await user.keyboard('{Control>}n{/Control}')
    await user.type(await screen.findByLabelText('Název'), 'Odkazovač')
    await user.click(screen.getByRole('button', { name: 'Vytvořit' }))
    await waitForOpenNote(/Odkazovač/)

    await user.clear(editor())
    await user.paste('Víc najdeš v [[Seznam ke čtení]].')
    await waitForSave('Odkazovač.md', '[[Seznam ke čtení]]')

    // Rename the linked-to note.
    const list = screen.getByLabelText('Poznámky')
    await user.click(within(list).getByText('Seznam ke čtení'))
    await waitForOpenNote(/Seznam ke čtení/)

    await user.keyboard('{F2}')
    const titleField = await screen.findByLabelText('Nový název')
    await user.clear(titleField)
    await user.type(titleField, 'K přečtení')
    await user.click(screen.getByRole('button', { name: 'Přejmenovat' }))

    // The file moved ...
    await waitFor(() => {
      expect(vault.paths()).toContain('K přečtení.md')
      expect(vault.paths()).not.toContain('seznam-ke-cteni.md')
    })
    // ... and the inbound link followed it.
    await waitFor(() => {
      expect(vault.peek('Odkazovač.md')).toContain('[[K přečtení]]')
    })
  })

  it('shows a conflict view instead of overwriting an external edit', async () => {
    const user = userEvent.setup()
    await waitForOpenNote(/Seznam ke čtení/)

    // An unsaved local edit, appended at the end of the body.
    await user.click(editor())
    await user.keyboard('{Control>}{End}{/Control}')
    await user.paste('\nMoje neuložená věta.')
    expect(editor().value).toContain('Moje neuložená věta.')

    // Another device writes a different version of the same file.
    vault.simulateExternalEdit(
      'seznam-ke-cteni.md',
      [
        '---',
        'id: seed0001reading',
        'title: Seznam ke čtení',
        'created: 2026-09-01T09:00:00.000Z',
        'updated: 2026-09-15T10:00:00.000Z',
        'pinned: false',
        'tags: [knihy]',
        '---',
        '',
        '# Seznam ke čtení',
        '',
        'Upraveno na mobilu.',
        '',
      ].join('\n'),
    )

    const dialog = await screen.findByRole('dialog', { name: /změnil na disku/i })
    expect(within(dialog).getByText(/Upraveno na mobilu./)).toBeInTheDocument()
    expect(within(dialog).getByText(/Moje neuložená věta./)).toBeInTheDocument()

    // Nothing was written while the user was deciding.
    expect(vault.peek('seznam-ke-cteni.md')).toContain('Upraveno na mobilu.')
    expect(vault.peek('seznam-ke-cteni.md')).not.toContain('Moje neuložená věta.')

    // Keeping the local version writes it, and only then.
    await user.click(within(dialog).getByRole('button', { name: 'Nechat moji verzi' }))
    await waitForSave('seznam-ke-cteni.md', 'Moje neuložená věta.')
  })
})

describe('recoverable states', () => {
  it('offers to create a note when a search matches nothing', async () => {
    const user = userEvent.setup()
    await waitForOpenNote(/Seznam ke čtení/)

    await user.type(screen.getByLabelText('Hledat v poznámkách a souborech'), 'nic tomu neodpovídá')

    const create = await screen.findByRole('button', { name: /Vytvořit „nic tomu neodpovídá“/ })
    await user.click(create)

    await waitFor(() => {
      expect(vault.paths()).toContain('nic tomu neodpovídá.md')
    })
  })

  it('reports an invalid note name instead of writing a broken file', async () => {
    const user = userEvent.setup()
    await waitForOpenNote(/Seznam ke čtení/)

    await user.keyboard('{Control>}n{/Control}')
    await user.type(await screen.findByLabelText('Název'), '...')
    await user.click(screen.getByRole('button', { name: 'Vytvořit' }))

    expect(await screen.findByText(/použitelné znaky/i)).toBeInTheDocument()
    expect(vault.paths()).toHaveLength(1)
  })

  it('rebuilds the index and says how many notes it found', async () => {
    const user = userEvent.setup()
    await waitForOpenNote(/Seznam ke čtení/)

    await user.click(screen.getByRole('button', { name: 'Přestavět rejstřík' }))
    expect(await screen.findByText(/Rejstřík: 1 poznámka/)).toBeInTheDocument()
  })
})
