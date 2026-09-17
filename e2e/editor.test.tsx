/**
 * End-to-end: lišta formátování a vzorce.
 *
 * Obojí má stejný smysl: psát poznámky, aniž by se člověk musel učit Markdown
 * nebo LaTeX. Test proto jde přes to, co uživatel dělá -- klikne na tlačítko,
 * naklikne vzorec -- a kontroluje dvě věci naráz: co se objevilo ve zdroji
 * a co se z toho vysázelo v náhledu.
 *
 * Samotné přepínání značek řeší `src/core/format.test.ts` a sázení
 * `src/core/math.test.ts`; tady jde o to, že je spolu spojuje živá aplikace.
 */

import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { App } from '@/App'
import { StoreProvider } from '@/state/store'
import { MemoryVault } from '@/vault'

const NOTE = [
  '---',
  'id: seed0001pokus',
  'title: Pokusná poznámka',
  'created: 2026-09-01T09:00:00.000Z',
  'updated: 2026-09-01T09:00:00.000Z',
  'pinned: false',
  'tags: []',
  '---',
  '',
  '',
].join('\n')

let vault: MemoryVault

const editor = () => screen.getByLabelText('Text poznámky') as HTMLTextAreaElement
const preview = () => screen.getByLabelText('Náhled')
const toolbar = () => screen.getByRole('toolbar', { name: 'Formátování' })
/**
 * Text poznámky bez koncového nového řádku.
 *
 * Poznámka v trezoru vždycky končí novým řádkem -- tak se soubory zapisují --
 * a do textarey se ten řádek promítne. Pro tvrzení o formátování je to šum.
 */
const body = () => editor().value.replace(/\n+$/, '')

async function renderApp() {
  vault = new MemoryVault({ seed: { 'pokus.md': NOTE }, label: 'Testovací trezor' })
  render(
    <StoreProvider vault={vault}>
      <App />
    </StoreProvider>,
  )
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  await screen.findByLabelText('Text poznámky')
}

/** Napsat do editoru a nechat kurzor tam, kde skončil. */
async function type(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(editor())
  await user.paste(text)
}

/** Označit v editoru úsek podle pozic. */
async function select(from: number, to: number) {
  await act(async () => {
    editor().setSelectionRange(from, to)
  })
}

beforeEach(async () => {
  await renderApp()
})

afterEach(() => {
  cleanup()
})

describe('lišta formátování', () => {
  it('je nad editorem a nabízí základní formátování', () => {
    for (const label of ['Tučně', 'Kurzíva', 'Nadpis 1', 'Odrážky', 'Tabulka', 'Odkaz na web']) {
      expect(within(toolbar()).getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('udělá z označeného textu tučný a v náhledu je opravdu tučný', async () => {
    const user = userEvent.setup()
    await type(user, 'Ahoj světe')
    await select(5, 10)

    await user.click(within(toolbar()).getByRole('button', { name: 'Tučně' }))

    await waitFor(() => {
      expect(body()).toBe('Ahoj **světe**')
    })
    await waitFor(() => {
      expect(preview().querySelector('strong')?.textContent).toBe('světe')
    })
  })

  it('druhé kliknutí formátování zase sundá', async () => {
    const user = userEvent.setup()
    await type(user, 'Ahoj světe')
    await select(5, 10)

    const bold = within(toolbar()).getByRole('button', { name: 'Tučně' })
    await user.click(bold)
    await waitFor(() => expect(body()).toBe('Ahoj **světe**'))

    // Výběr zůstal na slově, takže druhé kliknutí ho odtučňuje.
    await user.click(bold)
    await waitFor(() => expect(body()).toBe('Ahoj světe'))
  })

  it('bez výběru vloží ukázkový text a označí ho', async () => {
    const user = userEvent.setup()
    await user.click(editor())
    await user.click(within(toolbar()).getByRole('button', { name: 'Kurzíva' }))

    await waitFor(() => expect(body()).toBe('*kurzíva*'))
    // Označené, takže psaní ukázku rovnou přepíše. Výběr se vrací až po
    // překreslení, takže se na něj musí počkat stejně jako na text.
    await waitFor(() => {
      expect(editor().value.slice(editor().selectionStart, editor().selectionEnd)).toBe('kurzíva')
    })
  })

  it('udělá z několika řádků seznam', async () => {
    const user = userEvent.setup()
    await type(user, 'mléko\nchleba\nmáslo')
    await select(0, 18)

    await user.click(within(toolbar()).getByRole('button', { name: 'Odrážky' }))

    await waitFor(() => {
      expect(body()).toBe('- mléko\n- chleba\n- máslo')
    })
    await waitFor(() => {
      expect(preview().querySelectorAll('li')).toHaveLength(3)
    })
  })

  it('vloží tabulku, kterou náhled opravdu vysází', async () => {
    const user = userEvent.setup()
    await user.click(editor())
    await user.click(within(toolbar()).getByRole('button', { name: 'Tabulka' }))

    await waitFor(() => {
      expect(preview().querySelector('table')).not.toBeNull()
    })
    expect(preview().querySelectorAll('th')).toHaveLength(2)
  })

  it('ukáže u tlačítka náhled toho, co vloží', async () => {
    const user = userEvent.setup()
    await user.hover(within(toolbar()).getByRole('button', { name: 'Nadpis 1' }))

    const tip = await screen.findByRole('tooltip')
    // Zdroj i výsledek, aby bylo jasné, co se stane, ještě před kliknutím.
    expect(within(tip).getByText('# Nadpis')).toBeInTheDocument()
    expect(tip.querySelector('h1')?.textContent).toBe('Nadpis')
  })

  it('Ctrl + B v editoru dělá tučné, ne skrytí sekce Soubory', async () => {
    const user = userEvent.setup()
    await type(user, 'Ahoj')
    await select(0, 4)

    await user.keyboard('{Control>}b{/Control}')

    await waitFor(() => expect(body()).toBe('**Ahoj**'))
  })
})

describe('vzorce', () => {
  it('vysází vzorec ze zadání i s diakritikou v indexu', async () => {
    const user = userEvent.setup()
    await type(user, '$$\nc_{right} = \\frac{3^k}{2^n}\\left(c_{min} + B_{přímý}\\right)\n$$')

    await waitFor(() => {
      const math = preview().querySelector('.math--block')
      expect(math).not.toBeNull()
      // Opravdový zlomek, ne lomítko, a české písmeno v indexu prošlo.
      expect(math?.querySelector('.frac-line')).not.toBeNull()
      expect(math?.textContent).toContain('ř')
    })
    expect(preview().querySelector('.math--error')).toBeNull()
  })

  it('podtržítka ve vzorci nedělá kurzívou', async () => {
    const user = userEvent.setup()
    await type(user, 'Platí $c_{min} + c_{max}$ vždycky.')

    await waitFor(() => {
      expect(preview().querySelector('.math--inline')).not.toBeNull()
    })
    expect(preview().querySelector('em')).toBeNull()
  })

  it('cenu v dolarech nechá být', async () => {
    const user = userEvent.setup()
    await type(user, 'Stálo to 5$ a pak dalších 10$ navíc.')

    await waitFor(() => {
      expect(preview().textContent).toContain('5$')
    })
    expect(preview().querySelector('.katex')).toBeNull()
  })
})

describe('editor vzorců', () => {
  const dialog = () => screen.getByRole('dialog', { name: 'Vzorec' })

  it('se otevře z lišty a naklikaný vzorec vloží do poznámky', async () => {
    const user = userEvent.setup()
    await user.click(editor())
    await user.click(within(toolbar()).getByRole('button', { name: 'Editor vzorců...' }))

    const field = within(dialog()).getByLabelText('Zápis vzorce')
    await user.click(field)
    await user.paste('a^2 + b^2 = c^2')

    // Náhled se překresluje při psaní, takže je vidět, co z toho leze.
    await waitFor(() => {
      expect(dialog().querySelector('.math-preview .katex')).not.toBeNull()
    })

    await user.click(within(dialog()).getByRole('button', { name: 'Vložit vzorec' }))

    await waitFor(() => {
      expect(editor().value).toContain('$$\na^2 + b^2 = c^2\n$$')
    })
    await waitFor(() => {
      expect(preview().querySelector('.math--block')).not.toBeNull()
    })
  })

  it('paleta vkládá značky a pohltí přitom označený text', async () => {
    const user = userEvent.setup()
    await user.click(editor())
    await user.click(within(toolbar()).getByRole('button', { name: 'Editor vzorců...' }))

    const field = within(dialog()).getByLabelText('Zápis vzorce') as HTMLTextAreaElement
    await user.click(field)
    await user.paste('x')
    await act(async () => {
      field.setSelectionRange(0, 1)
    })

    await user.click(within(dialog()).getByRole('button', { name: 'Odmocnina' }))

    await waitFor(() => {
      expect(field.value).toBe('\\sqrt{x}')
    })
  })

  it('u rozbitého vzorce řekne česky, co je špatně', async () => {
    const user = userEvent.setup()
    await user.click(editor())
    await user.click(within(toolbar()).getByRole('button', { name: 'Editor vzorců...' }))

    await user.click(within(dialog()).getByLabelText('Zápis vzorce'))
    await user.paste('\\frac{1}{')

    expect(await within(dialog()).findByText(/chybí uzavírací závorka/)).toBeInTheDocument()
  })

  it('prázdný vzorec vložit nejde', async () => {
    const user = userEvent.setup()
    await user.click(editor())
    await user.click(within(toolbar()).getByRole('button', { name: 'Editor vzorců...' }))

    expect(within(dialog()).getByRole('button', { name: 'Vložit vzorec' })).toBeDisabled()
  })

  it('vzorec v řádku vloží mezi dolary, ne jako blok', async () => {
    const user = userEvent.setup()
    await user.click(editor())
    await user.click(within(toolbar()).getByRole('button', { name: 'Editor vzorců...' }))

    await user.click(within(dialog()).getByLabelText('Zápis vzorce'))
    await user.paste('E = mc^2')
    await user.click(within(dialog()).getByLabelText(/Na samostatném řádku/))
    await user.click(within(dialog()).getByRole('button', { name: 'Vložit vzorec' }))

    await waitFor(() => {
      expect(body()).toBe('$E = mc^2$')
    })
  })

  it('kliknutím na hotový vzorec v náhledu se otevře zpátky k úpravě', async () => {
    const user = userEvent.setup()
    await type(user, '$$\nE = mc^2\n$$')

    const math = await waitFor(() => {
      const found = preview().querySelector('.math--block')
      expect(found).not.toBeNull()
      return found as HTMLElement
    })

    await user.click(math)

    const field = await within(dialog()).findByLabelText('Zápis vzorce')
    expect(field).toHaveValue('E = mc^2')
    // Upravujeme, nevkládáme -- tlačítko to říká.
    expect(within(dialog()).getByRole('button', { name: 'Uložit změny' })).toBeInTheDocument()

    await user.clear(field)
    await user.paste('E = mc^3')
    await user.click(within(dialog()).getByRole('button', { name: 'Uložit změny' }))

    await waitFor(() => {
      expect(body()).toBe('$$\nE = mc^3\n$$')
    })
    // Nepřibyl druhý vzorec, ten původní se přepsal.
    expect(editor().value).not.toContain('mc^2')
  })

  it('jde otevřít z palety příkazů', async () => {
    const user = userEvent.setup()
    await user.keyboard('{Control>}k{/Control}')
    await user.type(await screen.findByLabelText('Příkaz nebo poznámka'), 'vzorc')
    await user.click(await screen.findByRole('option', { name: /Editor vzorců/ }))

    expect(await screen.findByRole('dialog', { name: 'Vzorec' })).toBeInTheDocument()
  })
})
